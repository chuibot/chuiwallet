import type { Runtime } from 'webextension-polyfill';
import type { ProviderRpc } from '@src/background/messaging/index';
import type { EthereumAdapter } from '@extension/backend/src/adapters/EthereumAdapter';
import { accountManager } from '@extension/backend/src/accountManager';
import { chainRegistry } from '@extension/backend/src/adapters/ChainRegistry';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { ChangeType } from '@extension/backend/src/types/cache';
import { walletManager } from '@extension/backend/src/walletManager';

export type RpcId = string | number;

export type RpcRequest = {
  jsonrpc: string;
  id: RpcId;
  method: string;
  params?: unknown;
};

export type RpcSuccessResponse = {
  jsonrpc: '2.0';
  id: RpcId;
  result: unknown;
};

export type RpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type RpcErrorResponse = {
  jsonrpc: '2.0';
  id: RpcId;
  error: RpcErrorObject;
};

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

/** Account the user picked in the approval window; -1 means the request was rejected. */
type ApprovalOutcome = { approved: boolean; accountListIndex: number };

type PendingApproval = {
  id: string;
  origin: string;
  rpc: RpcRequest;
  windowId?: number;
  resolve: (outcome: ApprovalOutcome) => void;
  reject: (err: string) => void;
};

/** Account offered in the approval window. `listIndex` is what the popup sends back. */
export type ApprovalAccount = {
  listIndex: number;
  name: string;
};

type Handler = (accountListIndex: number) => Promise<unknown> | unknown;

type ProviderAddresses = {
  bitcoin: {
    xpub?: string | null;
    receivingAddress: string | null;
    changeAddress: string | null;
  };
  evm: {
    address: string | null;
  };
};

const rpcVersion = '2.0';
const pendingApprovals = new Map<string, PendingApproval>();
const APPROVAL_WINDOW_WIDTH = 400;
const APPROVAL_WINDOW_HEIGHT = 660;

const handlers: Record<string, Handler> = {
  getXpub: accountListIndex => {
    return walletManager.getAccountXpub(accountListIndex);
  },
  getAddresses: async accountListIndex => {
    return getAddresses(accountListIndex);
  },
  getXpubAddresses: async accountListIndex => {
    const addresses = await getAddresses(accountListIndex);
    return {
      ...addresses,
      bitcoin: {
        ...addresses.bitcoin,
        xpub: walletManager.getAccountXpub(accountListIndex),
      },
    };
  },
};

function generateApprovalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const rejected: ApprovalOutcome = { approved: false, accountListIndex: -1 };

chrome.windows.onRemoved.addListener(windowId => {
  for (const [approvalId, item] of pendingApprovals.entries()) {
    if (item.windowId === windowId) {
      pendingApprovals.delete(approvalId);
      item.resolve(rejected);
    }
  }
});

/** Accounts a dApp may be pointed at: the active network's, in the order the popup lists them. */
function connectableAccounts(): ApprovalAccount[] {
  const activeNetwork = preferenceManager.get().activeNetwork;
  return accountManager.accounts
    .map((account, listIndex) => ({ listIndex, name: account.name, network: account.network }))
    .filter(({ network }) => network === activeNetwork)
    .map(({ listIndex, name }) => ({ listIndex, name }));
}

function isConnectableAccount(accountListIndex: number): boolean {
  return connectableAccounts().some(account => account.listIndex === accountListIndex);
}

export function getApprovalRequest(approvalId: string) {
  const item = pendingApprovals.get(approvalId);
  if (!item) throw new Error('Approval not found');
  return {
    id: item.id,
    origin: item.origin,
    rpc: item.rpc,
    accounts: connectableAccounts(),
    activeAccountListIndex: accountManager.activeAccountIndex,
  };
}

/**
 * Resolve with the account the user chose. The choice applies to this request only — the
 * wallet's own active account is deliberately left alone so a dApp can read one account
 * while the user keeps working in another.
 */
export function resolveApproval(approvalId: string, approved: boolean, accountListIndex: number) {
  const item = pendingApprovals.get(approvalId);
  if (!item) return;
  pendingApprovals.delete(approvalId);
  if (approved && !isConnectableAccount(accountListIndex)) {
    item.resolve(rejected);
    return;
  }
  item.resolve({ approved, accountListIndex });
}

export function rejectApproval(approvalId: string, reason: string) {
  const item = pendingApprovals.get(approvalId);
  if (!item) return;
  void reason;
  pendingApprovals.delete(approvalId);
  item.resolve(rejected);
}

async function requestUserApproval(origin: string, rpc: RpcRequest): Promise<ApprovalOutcome> {
  const approvalId = generateApprovalId();

  return await new Promise<ApprovalOutcome>((resolve, reject) => {
    pendingApprovals.set(approvalId, {
      id: approvalId,
      origin,
      rpc,
      resolve,
      reject,
    });

    chrome.windows.create(
      {
        url: chrome.runtime.getURL(`popup/index.html#/provider/approve?id=${approvalId}`),
        type: 'popup',
        width: APPROVAL_WINDOW_WIDTH,
        height: APPROVAL_WINDOW_HEIGHT,
      },
      window => {
        if (!window) return;
        const item = pendingApprovals.get(approvalId);
        if (item) {
          item.windowId = window.id;
        }
      },
    );
  });
}

export async function handle(message: ProviderRpc, sender: Runtime.MessageSender): Promise<RpcResponse> {
  const rpcRequest = message.params as RpcRequest;
  try {
    const fn = handlers[rpcRequest.method];
    if (!fn) return rpcErrorResponse(rpcRequest.id, -32601, `Method not found: ${rpcRequest.method}`);

    if (!walletManager.isRestorable()) {
      return rpcErrorResponse(
        rpcRequest.id,
        4100,
        'Wallet setup is incomplete. Create or restore a wallet before connecting.',
      );
    }

    const origin = originFromSender(sender);
    if (origin === 'unknown') {
      return rpcErrorResponse(rpcRequest.id, 4001, 'Request from non-web origin rejected');
    }
    const { approved, accountListIndex } = await requestUserApproval(origin, rpcRequest);
    if (!approved) {
      return rpcErrorResponse(rpcRequest.id, 4001, 'User rejected the request');
    }

    const data = await fn(accountListIndex);
    return rpcSuccessResponse(rpcRequest.id, data);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return rpcErrorResponse(rpcRequest.id, -32603, 'Internal error', errorMessage);
  }
}

// Bidi control codepoints that can visually reorder text to spoof domains.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/;

function originFromSender(sender: Runtime.MessageSender): string {
  if (!sender.url) return 'unknown';
  try {
    const parsed = new URL(sender.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'unknown';
    const hostname = parsed.hostname;
    // Reject empty, bidi-containing, or non-ASCII hostnames (IDN already punycode via WHATWG URL).
    if (!hostname || BIDI_CONTROLS.test(hostname) || /[^ -~]/.test(hostname)) return 'unknown';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${hostname}${port}`;
  } catch {
    return 'unknown';
  }
}

async function getAddresses(accountListIndex: number): Promise<ProviderAddresses> {
  const [receivingAddress, changeAddress] = await Promise.all([
    getBitcoinAddress(accountListIndex, ChangeType.External),
    getBitcoinAddress(accountListIndex, ChangeType.Internal),
  ]);

  return {
    bitcoin: { receivingAddress, changeAddress },
    evm: { address: getEvmAddress(accountListIndex) },
  };
}

async function getBitcoinAddress(accountListIndex: number, changeType: ChangeType): Promise<string | null> {
  try {
    return await walletManager.getAccountAddress(accountListIndex, changeType);
  } catch {
    return null;
  }
}

function getEvmAddress(accountListIndex: number): string | null {
  const adapter = chainRegistry.get(ChainType.Ethereum) as EthereumAdapter | undefined;
  const addressIndex = walletManager.getEvmAddressIndex(accountListIndex);
  if (!adapter || addressIndex === null) {
    return null;
  }

  try {
    return adapter.deriveAddress(0, addressIndex);
  } catch {
    return null;
  }
}

function rpcSuccessResponse(id: RpcId, result: unknown): RpcSuccessResponse {
  return {
    jsonrpc: rpcVersion,
    id,
    result,
  };
}

function rpcErrorResponse(id: RpcId, errorCode: number, message: string, data?: unknown): RpcErrorResponse {
  const error: RpcErrorObject = {
    code: errorCode,
    message,
  };

  if (data !== undefined) {
    error.data = data;
  }

  return {
    jsonrpc: rpcVersion,
    id,
    error,
  };
}
