import type { Runtime } from 'webextension-polyfill';
import type { ProviderRpc } from '@src/background/messaging/index';
import { chainRegistry } from '@extension/backend/src/adapters/ChainRegistry';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
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

type PendingApproval = {
  id: string;
  origin: string;
  rpc: RpcRequest;
  windowId?: number;
  resolve: (approved: boolean) => void;
  reject: (err: string) => void;
};

type Handler = (params: unknown, sender: Runtime.MessageSender) => Promise<unknown> | unknown;

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

const handlers: Record<string, Handler> = {
  getXpub: () => {
    return walletManager.getXpub();
  },
  getAddresses: async () => {
    return getAddresses();
  },
  getXpubAddresses: async () => {
    const addresses = await getAddresses();
    return {
      ...addresses,
      bitcoin: {
        ...addresses.bitcoin,
        xpub: walletManager.getXpub(),
      },
    };
  },
};

function generateApprovalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

chrome.windows.onRemoved.addListener(windowId => {
  for (const [approvalId, item] of pendingApprovals.entries()) {
    if (item.windowId === windowId) {
      pendingApprovals.delete(approvalId);
      item.resolve(false);
    }
  }
});

export function getApprovalRequest(approvalId: string) {
  const item = pendingApprovals.get(approvalId);
  if (!item) throw new Error('Approval not found');
  return {
    id: item.id,
    origin: item.origin,
    rpc: item.rpc,
  };
}

export function resolveApproval(approvalId: string, approved: boolean) {
  const item = pendingApprovals.get(approvalId);
  if (!item) return;
  pendingApprovals.delete(approvalId);
  item.resolve(approved);
}

export function rejectApproval(approvalId: string, reason: string) {
  const item = pendingApprovals.get(approvalId);
  if (!item) return;
  void reason;
  pendingApprovals.delete(approvalId);
  item.resolve(false);
}

async function requestUserApproval(origin: string, rpc: RpcRequest): Promise<boolean> {
  const approvalId = generateApprovalId();

  return await new Promise<boolean>((resolve, reject) => {
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
        width: 375,
        height: 600,
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

    const origin = originFromSender(sender);
    if (origin === 'unknown') {
      return rpcErrorResponse(rpcRequest.id, 4001, 'Request from non-web origin rejected');
    }
    const approved = await requestUserApproval(origin, rpcRequest);
    if (!approved) {
      return rpcErrorResponse(rpcRequest.id, 4001, 'User rejected the request');
    }

    const data = await fn(rpcRequest.params, sender);
    return rpcSuccessResponse(rpcRequest.id, data);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return rpcErrorResponse(rpcRequest.id, -32603, 'Internal error', errorMessage);
  }
}

// Bidi control codepoints that can visually reorder text to spoof domains.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

function originFromSender(sender: Runtime.MessageSender): string {
  if (!sender.url) return 'unknown';
  try {
    const parsed = new URL(sender.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'unknown';
    const hostname = parsed.hostname.replace(BIDI_CONTROLS, '');
    // Reject empty or non-ASCII hostnames (IDN should already be punycode via WHATWG URL parsing).
    if (!hostname || /[^\x00-\x7F]/.test(hostname)) return 'unknown';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${hostname}${port}`;
  } catch {
    return 'unknown';
  }
}

async function getAddresses(): Promise<ProviderAddresses> {
  return {
    bitcoin: {
      receivingAddress: getBitcoinAddress(ChangeType.External),
      changeAddress: getBitcoinAddress(ChangeType.Internal),
    },
    evm: {
      address: getEvmAddress(),
    },
  };
}

function getBitcoinAddress(changeType: ChangeType): string | null {
  try {
    return walletManager.getAddress(changeType) ?? null;
  } catch {
    return null;
  }
}

function getEvmAddress(): string | null {
  const adapter = chainRegistry.get(ChainType.Ethereum);
  if (!adapter) {
    return null;
  }

  try {
    return adapter.getReceivingAddress();
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
