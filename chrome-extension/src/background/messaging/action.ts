import type { Runtime } from 'webextension-polyfill';
import { Network } from '@extension/backend/src/types/electrum';
import type { EthereumAdapter } from '@extension/backend/src/adapters/EthereumAdapter';
import type { AppAction } from '@src/background/messaging/index';
import browser from 'webextension-polyfill';
import { getSessionPassword, setSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { getApprovalRequest, rejectApproval, resolveApproval } from '@src/background/messaging/rpc';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';
import { accountManager } from '@extension/backend/src/accountManager';
import { scanManager } from '@extension/backend/src/scanManager';
import { historyService } from '@extension/backend/src/modules/txHistoryService';
import { chainRegistry } from '@extension/backend/src/adapters/ChainRegistry';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
import { ChangeType } from '@extension/backend/src/types/cache';
import { logger } from '@extension/backend/src/utils/logger';

type Handler = (params: unknown, sender: Runtime.MessageSender) => Promise<unknown> | unknown;
type ParamsRecord = Record<string, unknown>;

class ActionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ActionError';
  }
}

function expectObjectParams(action: string, params: unknown): ParamsRecord {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}`);
  }
  return params as ParamsRecord;
}

function expectStringParam(
  action: string,
  params: ParamsRecord,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = params[key];
  if (typeof value !== 'string') {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}: "${key}" must be a string`);
  }
  if (!options.allowEmpty && value.trim().length === 0) {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}: "${key}" is required`);
  }
  return value;
}

function expectNumberParam(
  action: string,
  params: ParamsRecord,
  key: string,
  options: { integer?: boolean; min?: number } = {},
): number {
  const value = params[key];
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}: "${key}" must be a number`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}: "${key}" must be an integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}: "${key}" must be >= ${options.min}`);
  }
  return value;
}

function expectBooleanParam(action: string, params: ParamsRecord, key: string): boolean {
  const value = params[key];
  if (typeof value !== 'boolean') {
    throw new ActionError('BAD_REQUEST', `Invalid params for ${action}: "${key}" must be a boolean`);
  }
  return value;
}

function expectEnumParam<T extends string>(
  action: string,
  params: ParamsRecord,
  key: string,
  allowed: readonly T[],
): T {
  const value = params[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ActionError(
      'BAD_REQUEST',
      `Invalid params for ${action}: "${key}" must be one of ${allowed.map(item => `"${item}"`).join(', ')}`,
    );
  }
  return value as T;
}

async function requireUnlockedWallet(action: string): Promise<string> {
  const sessionPassword = await getSessionPassword();
  if (!sessionPassword) {
    throw new ActionError('WALLET_LOCKED', `${action} is unavailable while wallet is locked`);
  }
  return sessionPassword;
}

function getEthereumAdapter(): EthereumAdapter | undefined {
  return chainRegistry.get(ChainType.Ethereum) as EthereumAdapter | undefined;
}

function clearEthereumKeys(): void {
  const ethAdapter = getEthereumAdapter();
  if (ethAdapter) ethAdapter.clearKeys();
}

function triggerAccountScans(): void {
  void (async () => {
    try {
      await Promise.all([scanManager.backfillScan(), scanManager.backfillScan(ChangeType.Internal)]);
      await Promise.all([scanManager.forwardScan(), scanManager.forwardScan(ChangeType.Internal)]);
    } catch (error) {
      logger.error('Failed to trigger account scans', error);
    }
  })();
}

/**
 * Centralized helper to initialize EthereumAdapter.
 * Called on wallet restore, create, account switch/create, and network switch.
 */
async function hydrateEthAdapter(mnemonic: string, addressIndex: number, network: Network): Promise<void> {
  const ethAdapter = getEthereumAdapter();
  if (!ethAdapter) return;
  ethAdapter.initWithMnemonic(mnemonic, addressIndex);
  await ethAdapter.init(network);
}

const handlers: Record<string, Handler> = {
  'wallet.exist': () => {
    return walletManager.isRestorable();
  },
  'wallet.restore': async () => {
    const sessionPassword = await getSessionPassword();
    const isRestorable = await walletManager.restoreIfPossible(sessionPassword);
    if (isRestorable) {
      const mnemonic = walletManager.getMnemonic(sessionPassword!);
      if (mnemonic) {
        await hydrateEthAdapter(
          mnemonic,
          walletManager.getActiveAccountListIndex(),
          preferenceManager.get().activeNetwork,
        );
      }
      browser.alarms.create('forwardScan', { when: Date.now() + 100 });
    }
    return isRestorable;
  },
  'wallet.create': async params => {
    const payload = expectObjectParams('wallet.create', params);
    const mnemonic = expectStringParam('wallet.create', payload, 'mnemonic');
    const password = expectStringParam('wallet.create', payload, 'password');
    await walletManager.createWallet(mnemonic, password);
    await setSessionPassword(password);
    await hydrateEthAdapter(mnemonic, 0, preferenceManager.get().activeNetwork);
  },
  'wallet.getMnemonic': async () => {
    const password = await requireUnlockedWallet('wallet.getMnemonic');
    return walletManager.getMnemonic(password);
  },
  'wallet.getXpub': async () => {
    return walletManager.getXpub();
  },
  'wallet.verifyPassword': async params => {
    const payload = expectObjectParams('wallet.verifyPassword', params);
    const password = expectStringParam('wallet.verifyPassword', payload, 'password');
    return walletManager.verifyPassword(password);
  },
  'wallet.getBalance': async () => {
    return await walletManager.getBalance();
  },
  'wallet.getReceivingAddress': async () => {
    return walletManager.getAddress();
  },
  'wallet.switchNetwork': async params => {
    const payload = expectObjectParams('wallet.switchNetwork', params);
    const network = expectEnumParam('wallet.switchNetwork', payload, 'network', Object.values(Network));
    const success = await walletManager.switchNetwork(network);
    if (!success) {
      throw new ActionError('WALLET_LOCKED', 'wallet.switchNetwork is unavailable while wallet is locked');
    }

    const ethAdapter = getEthereumAdapter();
    if (ethAdapter) {
      await ethAdapter.init(network);
    }

    triggerAccountScans();
    return success;
  },
  'wallet.setBackupStatus': async (params: unknown) => {
    const payload = expectObjectParams('wallet.setBackupStatus', params);
    const isBackedUp = expectBooleanParam('wallet.setBackupStatus', payload, 'isBackedUp');
    // This will merge the new value and save to chrome.storage automatically
    return await preferenceManager.update({ isWalletBackedUp: isBackedUp });
  },
  'preferences.get': async () => {
    return preferenceManager.get();
  },
  'accounts.get': async () => {
    return accountManager.accounts;
  },
  'accounts.switch': async params => {
    await requireUnlockedWallet('accounts.switch');
    const payload = expectObjectParams('accounts.switch', params);
    const accountIndex = expectNumberParam('accounts.switch', payload, 'accountIndex', { integer: true, min: 0 });
    const preferences = await walletManager.switchAccount(accountIndex);

    const sessionPassword = await getSessionPassword();
    if (sessionPassword) {
      const mnemonic = walletManager.getMnemonic(sessionPassword);
      if (mnemonic) {
        await hydrateEthAdapter(mnemonic, accountIndex, preferenceManager.get().activeNetwork);
      }
    }

    triggerAccountScans();
    return preferences;
  },
  'accounts.create': async () => {
    await requireUnlockedWallet('accounts.create');
    const preferences = await walletManager.createAccount();

    const sessionPassword = await getSessionPassword();
    if (sessionPassword) {
      const mnemonic = walletManager.getMnemonic(sessionPassword);
      if (mnemonic) {
        await hydrateEthAdapter(
          mnemonic,
          walletManager.getActiveAccountListIndex(),
          preferenceManager.get().activeNetwork,
        );
      }
    }

    triggerAccountScans();
    return { preferences, accounts: accountManager.accounts };
  },
  'transactions.get': async () => {
    return await historyService.get();
  },
  'fee.estimates': async param => {
    if (typeof param !== 'string' || param.trim().length === 0) {
      throw new ActionError('BAD_REQUEST', 'Invalid params for fee.estimates: destination address is required');
    }
    return await walletManager.getFeeEstimates(param);
  },
  'payment.send': async param => {
    await requireUnlockedWallet('payment.send');
    const payload = expectObjectParams('payment.send', param);
    const toAddress = expectStringParam('payment.send', payload, 'toAddress');
    const amountInSats = expectNumberParam('payment.send', payload, 'amountInSats', { min: 1 });
    const feerate = expectNumberParam('payment.send', payload, 'feerate', { min: 1 });
    return await walletManager.sendPayment(toAddress, amountInSats, feerate);
  },
  'wallet.lock': async () => {
    await walletManager.lock();
    // Clear ETH key material from memory
    clearEthereumKeys();
  },
  'wallet.logout': async () => {
    await walletManager.logout();
    // Clear ETH key material from memory
    clearEthereumKeys();
  },
  'provider.getApproval': async params => {
    const payload = expectObjectParams('provider.getApproval', params);
    const id = expectNumberParam('provider.getApproval', payload, 'id', { integer: true, min: 0 });
    return getApprovalRequest(id);
  },
  'provider.resolveApproval': async params => {
    const payload = expectObjectParams('provider.resolveApproval', params);
    const id = expectNumberParam('provider.resolveApproval', payload, 'id', { integer: true, min: 0 });
    const approved = expectBooleanParam('provider.resolveApproval', payload, 'approved');
    resolveApproval(id, approved);
    return true;
  },
  'provider.rejectApproval': async params => {
    const payload = expectObjectParams('provider.rejectApproval', params);
    const id = expectNumberParam('provider.rejectApproval', payload, 'id', { integer: true, min: 0 });
    const reason = expectStringParam('provider.rejectApproval', payload, 'reason');
    rejectApproval(id, reason);
    return true;
  },
  ping: () => 'pong',
  echo: params => {
    const p = params as { msg?: unknown } | undefined;
    return { echoed: typeof p?.msg === 'string' ? p.msg : '' };
  },

  // Multi-Chain Handlers for Delegation to the chain adapter registry for a unified chain API.

  'chain.getBalance': async params => {
    const payload = expectObjectParams('chain.getBalance', params);
    const chain = expectEnumParam('chain.getBalance', payload, 'chain', Object.values(ChainType));
    const adapter = chainRegistry.get(chain);
    if (!adapter) throw new Error(`Unsupported chain: ${chain}`);
    return adapter.getBalance();
  },

  'chain.getAllBalances': async () => {
    return chainRegistry.getAllBalances();
  },

  'chain.getReceivingAddress': async params => {
    const payload = expectObjectParams('chain.getReceivingAddress', params);
    const chain = expectEnumParam('chain.getReceivingAddress', payload, 'chain', Object.values(ChainType));
    const adapter = chainRegistry.get(chain);
    if (!adapter) throw new Error(`Unsupported chain: ${chain}`);
    return adapter.getReceivingAddress();
  },

  'chain.getTransactionHistory': async params => {
    const payload = expectObjectParams('chain.getTransactionHistory', params);
    const chain = expectEnumParam('chain.getTransactionHistory', payload, 'chain', Object.values(ChainType));
    const adapter = chainRegistry.get(chain);
    if (!adapter) throw new Error(`Unsupported chain: ${chain}`);
    return adapter.getTransactionHistory();
  },

  'chain.estimateFee': async params => {
    const payload = expectObjectParams('chain.estimateFee', params);
    const chain = expectEnumParam('chain.estimateFee', payload, 'chain', Object.values(ChainType));
    const to = expectStringParam('chain.estimateFee', payload, 'to');
    const amount = expectNumberParam('chain.estimateFee', payload, 'amount', { min: 0 });
    const adapter = chainRegistry.get(chain);
    if (!adapter) throw new Error(`Unsupported chain: ${chain}`);
    return adapter.estimateFee(to, amount);
  },

  'chain.sendPayment': async params => {
    await requireUnlockedWallet('chain.sendPayment');
    const payload = expectObjectParams('chain.sendPayment', params);
    const chain = expectEnumParam('chain.sendPayment', payload, 'chain', Object.values(ChainType));
    const to = expectStringParam('chain.sendPayment', payload, 'to');
    const amount = expectNumberParam('chain.sendPayment', payload, 'amount', { min: 0 });
    const rawOptions = payload.options;
    const options =
      rawOptions === undefined
        ? undefined
        : (expectObjectParams('chain.sendPayment.options', rawOptions) as Record<string, unknown>);

    const adapter = chainRegistry.get(chain);
    if (!adapter) throw new Error(`Unsupported chain: ${chain}`);
    return adapter.sendPayment(to, amount, options);
  },
};

export type RouterResponse =
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: { code: string; message: string } };

export async function handle(message: AppAction, sender: Runtime.MessageSender): Promise<RouterResponse> {
  try {
    if (!message.action) {
      return { status: 'error', error: { code: 'BAD_REQUEST', message: 'Action is required' } };
    }
    const fn = handlers[message.action];
    if (!fn)
      return { status: 'error', error: { code: 'METHOD_NOT_FOUND', message: `Method not found: ${message.action}` } };
    const data = await fn(message.params, sender);
    return { status: 'ok', data };
  } catch (e) {
    if (e instanceof ActionError) {
      return { status: 'error', error: { code: e.code, message: e.message } };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'error', error: { code: 'INTERNAL', message: msg } };
  }
}
