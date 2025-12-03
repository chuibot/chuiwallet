import type { Runtime } from 'webextension-polyfill';
import type { ProviderRpc } from '@src/background/router/index';
import { walletManager } from '@extension/backend/src/walletManager';

export type RpcRequest = {
  jsonrpc: string;
  id: number;
  method: string;
  params?: unknown;
};

export type RpcSuccessResponse = {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
};

export type RpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type RpcErrorResponse = {
  jsonrpc: '2.0';
  id: number;
  error: RpcErrorObject;
};

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

type PendingApproval = {
  id: number;
  origin: string;
  rpc: RpcRequest;
  windowId?: number;
  resolve: (approved: boolean) => void;
  reject: (err: string) => void;
};

type Handler = (params: unknown, sender: Runtime.MessageSender) => Promise<unknown> | unknown;

const rpcVersion = '2.0';
const pendingApprovals = new Map<number, PendingApproval>();

const handlers: Record<string, Handler> = {
  getXpub: () => {
    return walletManager.getXpub();
  },
};

let nextApprovalId = 1;

chrome.windows.onRemoved.addListener(windowId => {
  for (const [approvalId, item] of pendingApprovals.entries()) {
    if (item.windowId === windowId) {
      pendingApprovals.delete(approvalId);
      item.reject('User rejected');
    }
  }
});

export function getApprovalRequest(approvalId: number) {
  const item = pendingApprovals.get(approvalId);
  if (!item) throw new Error('Approval not found');
  return {
    id: item.id,
    origin: item.origin,
    rpc: item.rpc,
  };
}

export function resolveApproval(approvalId: number, approved: boolean) {
  const item = pendingApprovals.get(approvalId);
  if (!item) return;
  pendingApprovals.delete(approvalId);
  item.resolve(approved);
}

export function rejectApproval(approvalId: number, reason: string) {
  const item = pendingApprovals.get(approvalId);
  if (!item) return;
  pendingApprovals.delete(approvalId);
  item.reject(reason);
}

async function requestUserApproval(origin: string, rpc: RpcRequest): Promise<boolean> {
  const approvalId = nextApprovalId++;

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

    const approved = await requestUserApproval(message.origin || 'unknown', rpcRequest);
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

function rpcSuccessResponse(id: number, result: unknown): RpcSuccessResponse {
  return {
    jsonrpc: rpcVersion,
    id,
    result,
  };
}

function rpcErrorResponse(id: number, errorCode: number, message: string, data?: unknown): RpcErrorResponse {
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
