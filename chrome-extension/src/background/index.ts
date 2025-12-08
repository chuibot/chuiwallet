import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { logger } from '@extension/backend/src/utils/logger';
import { scanManager } from '@extension/backend/src/scanManager';
import { registerMessageRouter } from '@src/background/messaging';
import { emitConnection, registerMessagePort } from '@src/background/messaging/port';
import { ChangeType } from '@extension/backend/src/types/cache';
import browser from 'webextension-polyfill';

bitcoin.initEccLib(secp256k1);

async function init() {
  await preferenceManager.init();
  await walletManager.init();
  await electrumService.init(preferenceManager.get().activeNetwork);
  electrumService.onStatus.on(update => {
    emitConnection(update.status, update.detail);
  });
  await electrumService.connect();
  await accountManager.init(preferenceManager.get().activeAccountIndex);
  if (accountManager.activeAccountIndex >= 0) {
    await scanManager.init();
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
  browser.alarms.create('backfillScan', { periodInMinutes: 0.2 });
}

browser.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'forwardScan') {
    // Todo: move scan queue to scan manager
    await forwardScan();
  }
  if (alarm.name === 'backfillScan') {
    await backfillScan();
  }
});
