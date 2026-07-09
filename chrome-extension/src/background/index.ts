import browser from 'webextension-polyfill';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { logger } from '@extension/backend/src/utils/logger';
import { ensureChainAdaptersReady } from '@src/background/bootstrap';
import { registerMessageRouter } from '@src/background/messaging';
import { emitConnection, registerMessagePort } from '@src/background/messaging/port';
import {
  registerScanRuntime,
  runAllScans,
  runBackfillScan,
  runForwardScan,
  runHotScan,
} from '@src/background/scanRuntime';

bitcoin.initEccLib(secp256k1);

let electrumReconnecting = false;
let electrumReconnectAttempt = 0;
let electrumReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let electrumReconnectEpoch = 0;

function cancelElectrumReconnect() {
  electrumReconnectEpoch++;
  electrumReconnectAttempt = 0;
  // Release the flag immediately so a fresh disconnect can schedule a new
  // attempt without waiting for the cancelled IIFE to drain.
  electrumReconnecting = false;
  if (electrumReconnectTimer) {
    clearTimeout(electrumReconnectTimer);
    electrumReconnectTimer = null;
  }
}

function scheduleElectrumReconnect() {
  if (electrumReconnecting) return;
  if (electrumReconnectTimer) {
    clearTimeout(electrumReconnectTimer);
    electrumReconnectTimer = null;
  }
  const epoch = electrumReconnectEpoch;
  electrumReconnecting = true;
  void (async () => {
    try {
      await electrumService.connect();
      if (epoch === electrumReconnectEpoch) electrumReconnectAttempt = 0;
    } catch (err) {
      logger.error('Electrum reconnect failed', err);
      // Bail if this attempt was cancelled mid-flight (e.g. by switchNetwork).
      if (epoch !== electrumReconnectEpoch) return;
      const delay = Math.min(30_000, 1000 * 2 ** electrumReconnectAttempt);
      electrumReconnectAttempt++;
      electrumReconnectTimer = setTimeout(() => {
        electrumReconnectTimer = null;
        scheduleElectrumReconnect();
      }, delay);
    } finally {
      // Only the matching attempt may clear the flag — a cancelled IIFE
      // finishing late must not stomp the fresh attempt that took over.
      if (epoch === electrumReconnectEpoch) electrumReconnecting = false;
    }
  })();
}

async function init() {
  await ensureChainAdaptersReady();

  await electrumService.init(preferenceManager.get().activeNetwork);

  electrumService.onStatus.on(update => {
    emitConnection(update.status, update.detail);
    if (update.reason === 'switchNetwork') {
      cancelElectrumReconnect();
      return;
    }
    if (update.status === 'connected') {
      cancelElectrumReconnect();
      void runHotScan().catch(error => logger.error('Hot scan after reconnect failed', error));
      return;
    }
    if (update.status === 'disconnected') {
      scheduleElectrumReconnect();
    }
  });
  await electrumService.connect();
  setupAlarms();
  await runAllScans();
}

registerScanRuntime();

(async () => {
  await init().catch(error => {
    logger.error(error);
  });
})();

registerMessageRouter();
registerMessagePort();

browser.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

function setupAlarms() {
  browser.alarms.create('forwardScan', { periodInMinutes: 3 });
  browser.alarms.create('backfillScan', { periodInMinutes: 1 });
}

browser.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'forwardScan') {
    await runForwardScan();
  }
  if (alarm.name === 'backfillScan') {
    await runBackfillScan();
  }
});
