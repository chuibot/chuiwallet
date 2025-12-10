import type { RpcRequest } from '@src/background/messaging/rpc';
import { handle as handleAction } from '@src/background/messaging/action';
import { handle as handleRpc } from '@src/background/messaging/rpc';
import browser, { Runtime } from 'webextension-polyfill';
import MessageSender = Runtime.MessageSender;

export type RouterAction = AppAction | ProviderRpc;
export type AppAction = { type: 'APP_ACTION'; action: string; params?: unknown };
export type ProviderRpc = { type: 'PROVIDER_RPC'; params: RpcRequest; origin: string };

function isRouterAction(message: unknown): message is RouterAction {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    ((message as RouterAction).type === 'APP_ACTION' || (message as RouterAction).type === 'PROVIDER_RPC')
  );
}

function isBadRouterRequest() {
  return Promise.resolve({
    status: 'error',
    error: { code: 'BAD_REQUEST', message: 'Invalid message' },
  });
}

export function registerMessageRouter() {
  browser.runtime.onMessage.addListener((message: unknown, sender: MessageSender) => {
    if (!isRouterAction(message)) {
      return isBadRouterRequest();
    }

    switch (message.type) {
      case 'APP_ACTION':
        return handleAction(message, sender);
      case 'PROVIDER_RPC':
        return handleRpc(message, sender);
      default:
        return isBadRouterRequest();
    }
  });
}
