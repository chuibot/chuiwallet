import type { ScanEvent } from '@extension/backend/src/types/cache';
import { ChangeType } from '@extension/backend/src/types/cache';
import browser from 'webextension-polyfill';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { logger } from '@extension/backend/src/utils/logger';
import { scanManager } from '@extension/backend/src/scanManager';
import { ensureChainAdaptersReady } from '@src/background/bootstrap';
import { registerMessageRouter } from '@src/background/messaging';
import { emitBalance, emitConnection, registerMessagePort } from '@src/background/messaging/port';

bitcoin.initEccLib(secp256k1);

let electrumReconnecting = false;

async function init() {
  await ensureChainAdaptersReady();

  await electrumService.init(preferenceManager.get().activeNetwork);

  electrumService.onStatus.on(update => {
    emitConnection(update.status, update.detail);
    if (update.status === 'disconnected' && !electrumReconnecting && update.reason !== 'switchNetwork') {
      electrumReconnecting = true;
      void (async () => {
        try {
          await electrumService.connect();
        } catch (err) {
          logger.error('Electrum reconnect failed', err);
        } finally {
          electrumReconnecting = false;
        }
      })();
    }
  });
  await electrumService.connect();
  if (accountManager.activeAccountIndex >= 0) {
    await scanManager.init();
    scanManager.onStatus.on(async (event: ScanEvent) => {
      if (event.historyChanged || event.utxoChanged) {
        console.log('Scan Event: ', event);
      }
      if (event.utxoChanged) {
        emitBalance(accountManager.activeAccountIndex, await walletManager.getBalance());
      }
    });
    await allScan();
  }
}

(async () => {
  await init().catch(error => {
    logger.error(error);
  });
})();

registerMessageRouter();
registerMessagePort();

async function allScan() {
  if (accountManager.activeAccountIndex >= 0) {
    await forwardScan();
    await backfillScan();
  }
}

async function backfillScan() {
  if (accountManager.activeAccountIndex >= 0) {
    await scanManager.backfillScan();
    await scanManager.backfillScan(ChangeType.Internal);
  }
}

async function forwardScan() {
  if (accountManager.activeAccountIndex >= 0) {
    await scanManager.forwardScan();
    await scanManager.forwardScan(ChangeType.Internal);
  }
}

browser.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

function setupAlarms() {
  browser.alarms.create('forwardScan', { periodInMinutes: 3 });
  // Chrome clamps alarms below 30s, and a 6s period (0.1) was both clamped and
  // wasteful. Backfill only needs to react within a block (~10 min); 1 min keeps
  // confirmation status fresh without burning service-worker wakeups.
  browser.alarms.create('backfillScan', { periodInMinutes: 1 });
}

// Kick a scan whenever the popup opens. The popup connects via the 'chui-app'
// port (see registerMessagePort), and that connection keeps the SW alive while
// the popup is in use, so the scan completes on the same wakeup. The inflight
// promise dedupes rapid reconnects (e.g. popup re-open while a scan is running).
let scanKickoffInflight: Promise<void> | null = null;
async function kickoffScan() {
  if (scanKickoffInflight) return scanKickoffInflight;
  if (accountManager.activeAccountIndex < 0) return;
  scanKickoffInflight = (async () => {
    try {
      await forwardScan();
      await backfillScan();
    } catch (err) {
      logger.error('Popup-open scan kickoff failed', err);
    } finally {
      scanKickoffInflight = null;
    }
  })();
  return scanKickoffInflight;
}

browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'chui-app') return;
  void kickoffScan();
});

browser.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'forwardScan') {
    // Todo: move scan queue to scan manager
    await forwardScan();
  }
  if (alarm.name === 'backfillScan') {
    await backfillScan();
  }
});
