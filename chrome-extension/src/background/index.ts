import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import type { ConnectionStatus } from '@extension/backend/src/types/electrum';
import { handle } from './router';
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

bitcoin.initEccLib(secp256k1);

async function init() {
  await preferenceManager.init();
  await walletManager.init();

  await discoverPeers();

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

// Message Action Router

browser.runtime.onMessage.addListener((message: unknown, sender: MessageSender) => {
  if (!message || typeof message !== 'object' || !('action' in (message as never))) {
    return Promise.resolve({ status: 'error', error: { code: 'BAD_REQUEST', message: 'Invalid message' } });
  }
  return handle(message as never, sender);
});

// ON Network Change
// browser.storage.onChanged.addListener((changes, area) => {
//   if (area === 'local' && changes.storedAccount) {
//     console.log('Network changing to', changes.storedAccount.newValue.network);
//     initElectrum(changes.storedAccount.newValue.network);
//     electrum.autoSelectAndConnect().catch(err => {
//       console.error('Failed to connect to Electrum server:', err);
//     });
//   }
// });

browser.runtime.onInstalled.addListener(() => {
  console.log('onInstall');
  setupAlarms();
});

browser.runtime.onStartup.addListener(() => {
  console.log('onStartup');
});

function setupAlarms() {
  browser.alarms.create('forwardScan', { periodInMinutes: 3 });
  browser.alarms.create('peerDiscovery', { periodInMinutes: 1440 }); // Daily
  browser.alarms.create('reconnectElectrum', { periodInMinutes: 60 });
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
  if (alarm.name === 'peerDiscovery') {
    await discoverPeers();
  }
  if (alarm.name === 'reconnectElectrum') {
    await reconnectElectrum();
  }
});
