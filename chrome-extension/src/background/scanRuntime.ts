import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { scanManager } from '@extension/backend/src/scanManager';
import { syncLog, type SyncLogEntry, type SyncStatus } from '@extension/backend/src/modules/syncLog';
import { walletManager } from '@extension/backend/src/walletManager';
import { ChangeType, type ScanEvent } from '@extension/backend/src/types/cache';
import type { Network } from '@extension/backend/src/types/electrum';
import { logger } from '@extension/backend/src/utils/logger';
import { emitBalance, emitSync, getActivePopupPortCount, onPopupSessionChanged } from '@src/background/messaging/port';

const FOREGROUND_HOT_SCAN_MS = 5_000;

let registered = false;
let activeScanKey: string | null = null;
let foregroundHotScanTimer: ReturnType<typeof setInterval> | null = null;
// In-flight indicated passes per context key. Per-context (not a global counter) so a pass
// still unwinding for one account can never be misread as syncing for another.
const syncInflight = new Map<string, number>();
let resyncInflight: { key: string; promise: Promise<SyncLogEntry | null> } | null = null;

function scanKey(): string | null {
  try {
    const prefs = preferenceManager.get();
    const account = accountManager.getActiveAccount();
    if (prefs.activeNetwork !== account.network || prefs.activeAccountIndex !== accountManager.activeAccountIndex) {
      return null;
    }
    return `${account.network}:${accountManager.activeAccountIndex}:${account.index}`;
  } catch {
    return null;
  }
}

export function registerScanRuntime(): void {
  if (registered) return;
  registered = true;

  scanManager.onStatus.on(async (event: ScanEvent) => {
    if (!event.utxoChanged) return;
    try {
      const account = accountManager.getActiveAccount();
      const balance = await walletManager.getBalance({ includeFiat: false });
      emitBalance(accountManager.activeAccountIndex, account.network, balance);
    } catch (error) {
      logger.error('Failed to emit balance update', error);
    }
  });

  onPopupSessionChanged.on(({ activeCount }) => {
    if (activeCount > 0) {
      startForegroundHotPolling();
    } else {
      stopForegroundHotPolling();
    }
  });

  if (getActivePopupPortCount() > 0) startForegroundHotPolling();
}

export async function ensureScanRuntime(): Promise<boolean> {
  const key = scanKey();
  if (!key) return false;
  if (activeScanKey !== key) {
    await scanManager.init();
    if (scanKey() !== key) return false;
    activeScanKey = key;
  }
  return true;
}

export async function runHotScan(): Promise<void> {
  if (!(await ensureScanRuntime())) return;
  await scanManager.scanHotReceiveAddresses();
}

export async function runBackfillScan(): Promise<void> {
  if (!(await ensureScanRuntime())) return;
  await Promise.all([scanManager.backfillScan(), scanManager.backfillScan(ChangeType.Internal)]);
}

export async function runForwardScan(): Promise<void> {
  if (!(await ensureScanRuntime())) return;
  await Promise.all([scanManager.forwardScan(), scanManager.forwardScan(ChangeType.Internal)]);
}

const SYNCED_CONTEXTS_KEY = 'scanSyncedContexts';

type SyncContext = { accountListIndex: number; accountIndex: number; network: Network };

function syncContext(): SyncContext | null {
  try {
    const account = accountManager.getActiveAccount();
    return {
      accountListIndex: accountManager.activeAccountIndex,
      accountIndex: account.index,
      network: account.network,
    };
  } catch {
    return null;
  }
}

// Keyed by HD index rather than list position so the marker survives list reordering.
// Lives in storage.session: survives MV3 worker restarts, resets with the browser.
async function isContextSynced(contextKey: string): Promise<boolean> {
  const stored = await chrome.storage.session.get([SYNCED_CONTEXTS_KEY]);
  const synced = stored[SYNCED_CONTEXTS_KEY];
  return Array.isArray(synced) && synced.includes(contextKey);
}

async function markContextSynced(contextKey: string): Promise<void> {
  const stored = await chrome.storage.session.get([SYNCED_CONTEXTS_KEY]);
  const synced = Array.isArray(stored[SYNCED_CONTEXTS_KEY]) ? (stored[SYNCED_CONTEXTS_KEY] as string[]) : [];
  if (synced.includes(contextKey)) return;
  await chrome.storage.session.set({ [SYNCED_CONTEXTS_KEY]: [...synced, contextKey] });
}

function syncContextKey(ctx: SyncContext): string {
  return `${ctx.network}:${ctx.accountIndex}`;
}

function isActiveContext(key: string): boolean {
  const current = syncContext();
  return current !== null && syncContextKey(current) === key;
}

/** Whether the ACTIVE account's first sync or a resync is running, never another account's. */
export function isActiveSyncRunning(): boolean {
  const ctx = syncContext();
  return ctx !== null && (syncInflight.get(syncContextKey(ctx)) ?? 0) > 0;
}

function beginSyncIndicator(ctx: SyncContext, key: string): void {
  const inflight = (syncInflight.get(key) ?? 0) + 1;
  syncInflight.set(key, inflight);
  if (inflight === 1) emitSync(ctx.accountListIndex, ctx.network, true);
}

function endSyncIndicator(ctx: SyncContext, key: string): void {
  const inflight = (syncInflight.get(key) ?? 1) - 1;
  if (inflight > 0) {
    syncInflight.set(key, inflight);
  } else {
    syncInflight.delete(key);
    emitSync(ctx.accountListIndex, ctx.network, false);
  }
}

/**
 * Only a context's FIRST connected pass this browser session drives the popup's sync
 * indicator. Full passes rerun on every popup open (wallet.restore) and worker cold start,
 * and the alarm/hot-poll scans never stop — signaling all of them would spin forever.
 * A disconnected pass scans nothing, so it runs silently and leaves the context unsynced;
 * runPostConnectScan indicates the real discovery once a server is reachable.
 */
export async function runAllScans(): Promise<void> {
  const ctx = syncContext();
  if (!ctx) return;

  const key = syncContextKey(ctx);
  const indicated = electrumService.status === 'connected' && !(await isContextSynced(key));
  if (indicated) beginSyncIndicator(ctx, key);
  try {
    await runHotScan();
    await Promise.all([runBackfillScan(), runForwardScan()]);
    // Only a pass that finished on this account, still connected, counts as its first sync.
    // Switching accounts mid-pass makes the scans return without doing anything, and marking
    // that as synced would leave the abandoned account with no indicator on the way back.
    if (indicated && isActiveContext(key) && electrumService.status === 'connected') {
      await markContextSynced(key);
    }
  } finally {
    if (indicated) endSyncIndicator(ctx, key);
  }
}

/** Rescans every derived address of the active account and records the outcome in its sync log. */
export function runResync(): Promise<SyncLogEntry | null> {
  const ctx = syncContext();
  if (!ctx) return Promise.resolve(null);
  const key = syncContextKey(ctx);
  // A switch away and back keeps the account key but abandons the scans, so a run is only shared within one epoch.
  const epoch = scanManager.getEpoch();
  const inflightKey = `${key}:${epoch}`;
  if (resyncInflight?.key === inflightKey) return resyncInflight.promise;
  const promise = resync(ctx, key, epoch, syncLog.captureGeneration()).finally(() => {
    if (resyncInflight?.promise === promise) resyncInflight = null;
  });
  resyncInflight = { key: inflightKey, promise };
  return promise;
}

async function resync(ctx: SyncContext, key: string, epoch: number, logGeneration: number): Promise<SyncLogEntry> {
  const startedAt = Date.now();
  beginSyncIndicator(ctx, key);
  try {
    const { status, error } = await rescan(key, epoch);
    const entry: SyncLogEntry = { startedAt, finishedAt: Date.now(), status, error };
    if (status === 'completed') {
      entry.receive = scanManager.getScanProgress(ChangeType.External);
      entry.change = scanManager.getScanProgress(ChangeType.Internal);
      await markContextSynced(key);
    }
    await syncLog.append(ctx, entry, logGeneration);
    return entry;
  } finally {
    // After the append, so a Sync log page reloading on this event reads the new entry.
    endSyncIndicator(ctx, key);
  }
}

async function rescan(key: string, epoch: number): Promise<{ status: SyncStatus; error?: string }> {
  // scanKey() is null while a switch has moved the preferences but not the account manager, and the scans bail then.
  const interrupted = () => scanManager.getEpoch() !== epoch || scanKey() === null || !isActiveContext(key);
  try {
    if (!(await ensureScanRuntime())) return { status: 'interrupted' };
    if (electrumService.status !== 'connected') return { status: 'offline' };
    // Both chains settle before the run ends, so a retry never overlaps a scan still writing UTXOs.
    const results = await Promise.allSettled([
      scanManager.fullScan(ChangeType.External),
      scanManager.fullScan(ChangeType.Internal),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (interrupted()) return { status: 'interrupted' };
    if (electrumService.status !== 'connected') return { status: 'offline' };
    return { status: 'completed' };
  } catch (e) {
    return { status: interrupted() ? 'interrupted' : 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * On (re)connect: the active account's first discovery runs as an indicated full pass;
 * an already-synced account gets the same cheap hot refresh as before.
 */
export async function runPostConnectScan(): Promise<void> {
  const ctx = syncContext();
  if (ctx && !(await isContextSynced(syncContextKey(ctx)))) {
    await runAllScans();
    return;
  }
  await runHotScan();
}

export function resetScanRuntime(): void {
  activeScanKey = null;
  // Runs on wallet create/logout — the next wallet's accounts get first-sync indication again.
  void chrome.storage.session.remove([SYNCED_CONTEXTS_KEY]);
  stopForegroundHotPolling();
  if (getActivePopupPortCount() > 0 && scanKey()) startForegroundHotPolling();
}

function startForegroundHotPolling(): void {
  if (foregroundHotScanTimer) return;
  void runHotScan().catch(error => logger.error('Foreground hot scan failed', error));
  foregroundHotScanTimer = setInterval(() => {
    void runHotScan().catch(error => logger.error('Foreground hot scan failed', error));
  }, FOREGROUND_HOT_SCAN_MS);
}

function stopForegroundHotPolling(): void {
  if (!foregroundHotScanTimer) return;
  clearInterval(foregroundHotScanTimer);
  foregroundHotScanTimer = null;
}
