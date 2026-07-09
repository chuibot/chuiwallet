import { accountManager } from '@extension/backend/src/accountManager';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { scanManager } from '@extension/backend/src/scanManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { ChangeType, type ScanEvent } from '@extension/backend/src/types/cache';
import { logger } from '@extension/backend/src/utils/logger';
import { emitBalance, getActivePopupPortCount, onPopupSessionChanged } from '@src/background/messaging/port';

const FOREGROUND_HOT_SCAN_MS = 5_000;

let registered = false;
let activeScanKey: string | null = null;
let foregroundHotScanTimer: ReturnType<typeof setInterval> | null = null;

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

export async function runAllScans(): Promise<void> {
  await runHotScan();
  await Promise.all([runBackfillScan(), runForwardScan()]);
}

export function resetScanRuntime(): void {
  activeScanKey = null;
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
