import type { ScanEvent } from '@extension/backend/src/types/cache';
import { ChangeType } from '@extension/backend/src/types/cache';
import browser from 'webextension-polyfill';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { logger } from '@extension/backend/src/utils/logger';
import { scanManager } from '@extension/backend/src/scanManager';
import { historyService } from '@extension/backend/src/modules/txHistoryService';
import { ensureBackgroundBootstrap } from '@src/background/bootstrap';
import { registerMessageRouter } from '@src/background/messaging';
import { emitBalance, emitConnection, registerMessagePort } from '@src/background/messaging/port';
import { chainRegistry } from '@extension/backend/src/adapters/ChainRegistry';
import { BitcoinAdapter } from '@extension/backend/src/adapters/BitcoinAdapter';
import { EthereumAdapter } from '@extension/backend/src/adapters/EthereumAdapter';

bitcoin.initEccLib(secp256k1);

let electrumReconnecting = false;

async function init() {
  await ensureBackgroundBootstrap();

  await electrumService.init(preferenceManager.get().activeNetwork);

  // Register chain adapters
  const btcAdapter = new BitcoinAdapter(walletManager, electrumService, scanManager, historyService);
  chainRegistry.register(btcAdapter);

  const ethAdapter = new EthereumAdapter({ rpcApiKey: preferenceManager.get().ethRpcApiKey });
  chainRegistry.register(ethAdapter);

  // Initialize ETH provider immediately so RPC calls work
  const activeNetwork = preferenceManager.get().activeNetwork;
  await ethAdapter.init(activeNetwork);

  // If wallet is already unlocked (e.g. after service worker restart), hydrate
  // the ETH adapter with the mnemonic so getReceivingAddress() works immediately
  const sessionPw = await getSessionPassword();
  if (sessionPw) {
    const mnemonic = await walletManager.getMnemonic(sessionPw);
    if (mnemonic) {
      ethAdapter.initWithMnemonic(mnemonic, walletManager.getActiveAccountListIndex());
    }
  }

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
});
