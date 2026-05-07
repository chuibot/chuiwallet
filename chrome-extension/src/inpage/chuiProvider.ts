import type { BtcProviderInfo, ChuiWalletProvider } from '@src/inpage/types';
import type { RpcRequest, RpcResponse, RpcSuccessResponse } from '@src/background/messaging/rpc';
import { ChuiRpcError } from '@src/inpage/types';
import { providerInfo } from '@src/inpage/meta';

declare global {
  interface Window {
    ChuiWalletProvider?: ChuiWalletProvider;
    btc_providers?: BtcProviderInfo[];
    btc?: {
      request<T = unknown>(method: string, params?: unknown): Promise<T>;
    };
  }
}

(function () {
  let nextId = 1;
  const provider: ChuiWalletProvider = {
    isChui: true,
    metadata: providerInfo,
    request<T = unknown>(method: string, params?: unknown): Promise<T> {
      const id = nextId++;
      const rpcRequest: RpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      return new Promise<T>((resolve, reject) => {
        function listener(event: MessageEvent) {
          if (
            event.source !== window ||
            !event.data ||
            event.data.source !== 'chui-content-script' ||
            event.data.type !== 'CHUI_BTC_RPC_RESPONSE'
          ) {
            return;
          }

          const rpcResponse = event.data.payload as RpcResponse;
          if (rpcResponse.id !== id) return;

          window.removeEventListener('message', listener);

          if ('error' in rpcResponse && rpcResponse.error) {
            const errObj = rpcResponse.error;
            return reject(new ChuiRpcError(errObj));
          }

          resolve((rpcResponse as RpcSuccessResponse).result as T);
        }

        window.addEventListener('message', listener);

        window.postMessage(
          {
            source: 'chui-inpage',
            type: 'CHUI_BTC_RPC_REQUEST',
            payload: rpcRequest,
          },
          '*',
        );
      });
    },
  };

  const frozenProvider = Object.freeze(provider);

  try {
    Object.defineProperty(window, 'ChuiWalletProvider', {
      value: frozenProvider,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    return;
  }

  const btcShim = Object.freeze({
    request: frozenProvider.request.bind(frozenProvider),
  });
  try {
    Object.defineProperty(window, 'btc', {
      value: btcShim,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    /* noop */
  }

  if (!Array.isArray(window.btc_providers)) {
    window.btc_providers = [];
  }
  const filtered = window.btc_providers.filter(p => !p || p.id !== providerInfo.id);
  filtered.push(providerInfo);
  window.btc_providers = filtered;
})();
