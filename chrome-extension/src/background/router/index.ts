import type { RpcRequest } from '@src/background/router/rpc';
import { handle as handleAction } from '@src/background/router/action';
import { handle as handleRpc } from '@src/background/router/rpc';
import browser, { Runtime } from 'webextension-polyfill';
import MessageSender = Runtime.MessageSender;

export type RouterAction = PopupAction | ProviderRpc;
export type PopupAction = { type: 'POPUP_ACTION'; action: string; params?: unknown };
export type ProviderRpc = { type: 'PROVIDER_RPC'; params: RpcRequest; origin: string };

function isRouterAction(message: unknown): message is RouterAction {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    ((message as RouterAction).type === 'POPUP_ACTION' || (message as RouterAction).type === 'PROVIDER_RPC')
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
      case 'POPUP_ACTION':
        return handleAction(message, sender);
      case 'PROVIDER_RPC':
        return handleRpc(message, sender);
      default:
        return isBadRouterRequest();
    }
  });
}
