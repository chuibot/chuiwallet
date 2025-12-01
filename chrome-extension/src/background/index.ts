import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import type { ConnectionStatus } from '@extension/backend/src/types/electrum';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { logger } from '@extension/backend/src/utils/logger';
import { scanManager } from '@extension/backend/src/scanManager';
import { registerMessageRouter } from '@src/background/router';
import { ChangeType } from '@extension/backend/src/types/cache';
import browser from 'webextension-polyfill';

bitcoin.initEccLib(secp256k1);

async function init() {
  await preferenceManager.init();
  await walletManager.init();
  await electrumService.init(preferenceManager.get().activeNetwork);
  electrumService.onStatus.on(update => {
    onConnection(update.status, update.detail);
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

const ports = new Set();
browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'chui-app') return;
  console.log('Adding port', port);
  ports.add(port);

  port.postMessage({ type: 'SNAPSHOT', data: 'this is from snapshot' });
  onConnection(electrumService.status);

  port.onDisconnect.addListener(() => {
    ports.delete(port);
    // if (ports.size === 0) stopScanner();
  });

  port.onMessage.addListener(msg => {
    if (msg.type === 'PING') port.postMessage({ type: 'PONG', t: Date.now() });
  });
});

function broadcast(payload: any) {
  for (const p of ports) {
    try {
      p.postMessage(payload);
    } catch {
      /* empty */
    }
  }
}

// Wire your Electrum scan callbacks to broadcast:
function onConnection(status: ConnectionStatus, detail?: string) {
  broadcast({ type: 'CONNECTION', status, detail, ts: Date.now() });
}

function onBalance(accountIndex: number, sat: number, fiat?: number) {
  broadcast({ type: 'BALANCE', accountIndex, sat, fiat, ts: Date.now() });
}

function onTx(accountIndex: number, tx: any) {
  broadcast({ type: 'TX', accountIndex, tx, ts: Date.now() });
}

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
