import type { Runtime } from 'webextension-polyfill';
import type { Network } from '@extension/backend/src/types/electrum';
import type { RouterAction } from '@src/background/router/index';
import browser from 'webextension-polyfill';
import { ChangeType } from '@extension/backend/src/types/cache';
import { getSessionPassword, setSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { scanManager } from '@extension/backend/src/scanManager';
import { historyService } from '@extension/backend/src/modules/txHistoryService';

type Handler = (params: unknown, sender: Runtime.MessageSender) => Promise<unknown> | unknown;

const handlers: Record<string, Handler> = {
  'wallet.exist': () => {
    return walletManager.isRestorable();
  },
  'wallet.restore': async () => {
    const sessionPassword = await getSessionPassword();
    const isRestorable = await walletManager.restoreIfPossible(sessionPassword);
    if (isRestorable) {
      browser.alarms.create('forwardScan', { when: Date.now() + 100 });
    }
    return isRestorable;
  },
  'wallet.create': async params => {
    const { mnemonic, password } = params as { mnemonic: string; password: string };
    await walletManager.createWallet(mnemonic, password);
    await setSessionPassword(password);
  },
  'wallet.getMnemonic': async () => {
    const password = await getSessionPassword();
    if (!password) {
      throw new Error('Password is required');
    }
    return walletManager.getMnemonic(password);
  },
  'wallet.getXpub': async () => {
    return walletManager.getXpub();
  },
  'wallet.verifyPassword': async params => {
    const { password } = params as { password: string };
    return walletManager.verifyPassword(password);
  },
  'wallet.getBalance': async () => {
    return await walletManager.getBalance();
  },
  'wallet.getReceivingAddress': async () => {
    return walletManager.getAddress();
  },
  'wallet.switchNetwork': async params => {
    const { network } = params as { network: Network };
    const success = await walletManager.switchNetwork(network);
    scanManager.backfillScan();
    scanManager.backfillScan(ChangeType.Internal);
    scanManager.forwardScan();
    scanManager.forwardScan(ChangeType.Internal);
    return success;
  },
  'preferences.get': async () => {
    return preferenceManager.get();
  },
  'accounts.get': async () => {
    return accountManager.accounts;
  },
  'transactions.get': async () => {
    return await historyService.get();
  },
  'fee.estimates': async param => {
    return await walletManager.getFeeEstimates(param as string);
  },
  'payment.send': async param => {
    const { toAddress, amountInSats, feerate } = param as { toAddress: string; amountInSats: number; feerate: number };
    if (!toAddress || !amountInSats || !feerate) {
      throw new Error('Missing required parameter');
    }
    return await walletManager.sendPayment(toAddress, amountInSats, feerate);
  },
  'wallet.lock': async () => {
    await walletManager.lock();
  },
  'wallet.logout': async () => {
    await walletManager.logout();
  },
  ping: () => 'pong',
  echo: params => {
    const p = params as { msg?: unknown } | undefined;
    return { echoed: typeof p?.msg === 'string' ? p.msg : '' };
  },
};

export type RouterResponse =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: { code: string; message: string } };

export async function handle(message: RouterAction, sender: Runtime.MessageSender): Promise<RouterResponse> {
  try {
    const fn = handlers[message.action!];
    if (!fn)
      return { status: 'error', error: { code: 'METHOD_NOT_FOUND', message: `Method not found: ${message.action}` } };
    const data = await fn(message.params, sender);
    return { status: 'ok', data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'error', error: { code: 'INTERNAL', message: msg } };
  }
}
