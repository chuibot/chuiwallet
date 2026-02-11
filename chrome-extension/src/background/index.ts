import type { ScanEvent } from '@extension/backend/src/types/cache';
import type { ServerConfig } from '@extension/backend/src/types/electrum';
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
import { discoverPeersFrom, simpleHealthCheck } from '@extension/backend/src/modules/electrumServer';
import { registerMessageRouter } from '@src/background/messaging';
import { emitBalance, emitConnection, registerMessagePort } from '@src/background/messaging/port';

bitcoin.initEccLib(secp256k1);

let electrumReconnecting = false;

async function init() {
  await preferenceManager.init();
  await walletManager.init();

  const network = preferenceManager.get().activeNetwork;

  // 1. Setup Status Listeners
  electrumService.onStatus.on(update => {
    emitConnection(update.status, update.detail);
    if (update.status === 'disconnected' && !electrumReconnecting && update.reason !== 'switchNetwork') {
      electrumReconnecting = true;
      checkConnection().finally(() => {
        electrumReconnecting = false;
      });
    }
  });

  // 2. Connect to the best server first
  await electrumService.init(network);
  await electrumService.connect();

  // 3. Discover peers in background AFTER we are online
  void discoverPeers();

  // 4. Initialize account and scanning
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
      logger.log('Fetching new peers from current server...');
      const rawPeers = await discoverPeersFrom(currentServer);

      logger.log(`Received ${rawPeers.length} peers from server`);

      // 1. Pick a random sample of 10 to test (don't test all at once!)
      const sample = rawPeers.sort(() => Math.random() - 0.5).slice(0, 10);

      logger.log(`Testing sample of ${sample.length} peers...`);

      // 2. Vet the sample with increased timeout
      const vettedResults = await Promise.all(sample.map(p => simpleHealthCheck(p)));
      const healthyNewPeers = vettedResults.filter(p => p.healthy);

      logger.log(`Vetted peers: Found ${healthyNewPeers.length} healthy out of ${sample.length} tested.`);

      // 3. Merge with existing cached peers
      const storageKey = `discoveredPeers_${network}`;
      const cached = await chrome.storage.local.get(storageKey);
      const existingPeers: ServerConfig[] = cached[storageKey] || [];

      // Add new healthy peers, avoiding duplicates by host
      const combined = [...healthyNewPeers, ...existingPeers];
      const uniquePeers = combined.filter((peer, index, self) => index === self.findIndex(p => p.host === peer.host));

      // 4. Store a clean list (capped at 50 to keep storage light)
      await chrome.storage.local.set({
        [storageKey]: uniquePeers.slice(0, 50),
        [`lastDiscovery_${network}`]: Date.now(),
      });

      logger.log(`Total cached peers: ${uniquePeers.length}`);
    }
  } catch (error) {
    logger.error('Peer discovery/vetting failed:', error);
  }
}

async function checkConnection() {
  try {
    const network = preferenceManager.get().activeNetwork;
    const currentServer = electrumService.getCurrentServer();

    if (currentServer) {
      logger.log(`Checking health of current server: ${currentServer.host}`);

      // Perform a quick health check on the active server
      const health = await simpleHealthCheck(currentServer);

      if (health.healthy && health.latency && health.latency < 1500) {
        logger.log('Current server is healthy and fast. Staying connected.');
        return; // Exit early, no need to reconnect
      }

      logger.log('Current server is slow or unhealthy. Searching for a better one...');
    }

    // If no server exists or current one is bad, find the best one and init
    await electrumService.init(network);
    await electrumService.connect();
  } catch (error) {
    logger.error('Maintenance check failed:', error);
  }
}

browser.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

function setupAlarms() {
  browser.alarms.create('backfillScan', { periodInMinutes: 0.1 });
  browser.alarms.create('forwardScan', { periodInMinutes: 3 });
  browser.alarms.create('checkConnection', { periodInMinutes: 60 });
  browser.alarms.create('peerDiscovery', { periodInMinutes: 1440 }); // Daily
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
  if (alarm.name === 'checkConnection') {
    await checkConnection();
  }
});
