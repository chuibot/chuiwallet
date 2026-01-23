import type { ScanEvent } from '@extension/backend/src/types/cache';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { logger } from '@extension/backend/src/utils/logger';
import { scanManager } from '@extension/backend/src/scanManager';
import { ChangeType } from '@extension/backend/src/types/cache';
import browser, { Runtime } from 'webextension-polyfill';
import MessageSender = Runtime.MessageSender;
import { discoverPeersFrom } from '@extension/backend/src/modules/electrumServer';
import { registerMessageRouter } from '@src/background/messaging';
import { emitBalance, emitConnection, registerMessagePort } from '@src/background/messaging/port';

bitcoin.initEccLib(secp256k1);

let electrumReconnecting = false;

async function init() {
  await preferenceManager.init();
  await walletManager.init();

  await discoverPeers();

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
  await accountManager.init(preferenceManager.get().activeAccountIndex);
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
async function discoverPeers() {
  try {
    const network = preferenceManager.get().activeNetwork;
    const currentServer = electrumService.getCurrentServer();

    if (currentServer) {
      logger.log('Discovering peers...');
      const peers = await discoverPeersFrom(currentServer);
      logger.log(`Discovered ${peers.length} peers`);

      // Store in chrome.storage
      await chrome.storage.local.set({
        [`discoveredPeers_${network}`]: peers,
        [`lastDiscovery_${network}`]: Date.now(),
      });
    }
  } catch (error) {
    logger.error('Peer discovery failed:', error);
  }
}

async function reconnectElectrum() {
  try {
    const network = preferenceManager.get().activeNetwork;
    logger.log('Reconnecting to best Electrum server...');
    await electrumService.init(network);
  } catch (error) {
    logger.error('Failed to reconnect:', error);
  }
}

browser.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

function setupAlarms() {
  browser.alarms.create('forwardScan', { periodInMinutes: 3 });
  browser.alarms.create('peerDiscovery', { periodInMinutes: 1440 }); // Daily
  browser.alarms.create('reconnectElectrum', { periodInMinutes: 60 });
  browser.alarms.create('backfillScan', { periodInMinutes: 0.1 });
}

browser.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'forwardScan') {
    // Todo: move scan queue to scan manager
    await forwardScan();
  }
  if (alarm.name === 'backfillScan') {
    await backfillScan();
  }
  if (alarm.name === 'peerDiscovery') {
    await discoverPeers();
  }
  if (alarm.name === 'reconnectElectrum') {
    await reconnectElectrum();
  }
});
