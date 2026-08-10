import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { scanManager } from '@extension/backend/src/scanManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { ChangeType, type ScanEvent } from '@extension/backend/src/types/cache';
import type { Network } from '@extension/backend/src/types/electrum';
import { logger } from '@extension/backend/src/utils/logger';
import { emitBalance, emitSync, getActivePopupPortCount, onPopupSessionChanged } from '@src/background/messaging/port';

const FOREGROUND_HOT_SCAN_MS = 5_000;

let registered = false;
let activeScanKey: string | null = null;
let foregroundHotScanTimer: ReturnType<typeof setInterval> | null = null;
// In-flight first-sync passes per context key. Per-context (not a global counter) so a pass
// still unwinding for one account can never be misread as syncing for another.
const firstSyncInflight = new Map<string, number>();

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

/** Whether the ACTIVE account's first sync is running — never another account's. */
export function isActiveFirstSyncRunning(): boolean {
  const ctx = syncContext();
  return ctx !== null && (firstSyncInflight.get(syncContextKey(ctx)) ?? 0) > 0;
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

  if (indicated) {
    const inflight = (firstSyncInflight.get(key) ?? 0) + 1;
    firstSyncInflight.set(key, inflight);
    if (inflight === 1) emitSync(ctx.accountListIndex, ctx.network, true);
  }
  try {
    await runHotScan();
    await Promise.all([runBackfillScan(), runForwardScan()]);
    // Connection may have dropped mid-pass — only a pass that finishes connected counts.
    if (indicated && electrumService.status === 'connected') {
      await markContextSynced(key);
    }
  } finally {
    if (indicated) {
      const inflight = (firstSyncInflight.get(key) ?? 1) - 1;
      if (inflight > 0) {
        firstSyncInflight.set(key, inflight);
      } else {
        firstSyncInflight.delete(key);
        emitSync(ctx.accountListIndex, ctx.network, false);
      }
    }
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
