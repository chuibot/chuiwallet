import type { Runtime } from 'webextension-polyfill';
import type { RouterAction } from '@src/background/router/index';
import { walletManager } from '@extension/backend/src/walletManager';

type Handler = (params: unknown, sender: Runtime.MessageSender) => Promise<unknown> | unknown;

export type RpcRequest = {
  jsonrpc: '2.0';
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

const handlers: Record<string, Handler> = {
  getXpub: () => {
    return walletManager.getXpub();
  },
};

export async function handle(message: RouterAction, sender: Runtime.MessageSender): Promise<RpcResponse> {
  try {
    const rpcRequest = message.params as RpcRequest;
    const fn = handlers[rpcRequest.method];
    if (!fn)
      return {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32601,
          message: `Method not found: ${message.action}`,
        } as RpcErrorObject,
      } as RpcErrorResponse;
    const data = await fn(rpcRequest.params, sender);
    return {
      jsonrpc: '2.0',
      id: rpcRequest.id,
      result: data,
    } as RpcSuccessResponse;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32603,
        message: 'Internal error',
        data: errorMessage,
      } as RpcErrorObject,
    };
  }
}
