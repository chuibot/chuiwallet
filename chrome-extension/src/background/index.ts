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
let electrumReconnectAttempt = 0;
let electrumReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleElectrumReconnect() {
  if (electrumReconnecting) return;
  if (electrumReconnectTimer) {
    clearTimeout(electrumReconnectTimer);
    electrumReconnectTimer = null;
  }
  electrumReconnecting = true;
  void (async () => {
    try {
      await electrumService.connect();
      electrumReconnectAttempt = 0;
    } catch (err) {
      logger.error('Electrum reconnect failed', err);
      const delay = Math.min(30_000, 1000 * 2 ** electrumReconnectAttempt);
      electrumReconnectAttempt++;
      electrumReconnectTimer = setTimeout(() => {
        electrumReconnectTimer = null;
        scheduleElectrumReconnect();
      }, delay);
    } finally {
      electrumReconnecting = false;
    }
  })();
}

async function init() {
  await ensureChainAdaptersReady();

  await electrumService.init(preferenceManager.get().activeNetwork);

  electrumService.onStatus.on(update => {
    emitConnection(update.status, update.detail);
    if (update.status === 'connected') {
      electrumReconnectAttempt = 0;
      if (electrumReconnectTimer) {
        clearTimeout(electrumReconnectTimer);
        electrumReconnectTimer = null;
      }
      return;
    }
    if (update.status === 'disconnected' && update.reason !== 'switchNetwork') {
      scheduleElectrumReconnect();
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
  browser.alarms.create('backfillScan', { periodInMinutes: 1 });
}

// 'chui-app' must remain popup-only; a content script reusing this name would let any page induce a scan.
browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'chui-app') return;
  if (accountManager.activeAccountIndex < 0) return;
  void allScan().catch(err => logger.error('Popup-open scan kickoff failed', err));
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
