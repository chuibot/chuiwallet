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
  if (window.ChuiWalletProvider) return;

  let nextId = 1;
  window.ChuiWalletProvider = {
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

  // Backward mapping to window.btc
  if (!window.btc) {
    window.btc = {
      request: window.ChuiWalletProvider.request.bind(window.ChuiWalletProvider),
    };
  }

  if (!window.btc_providers) {
    window.btc_providers = [];
  }

  if (!window.btc_providers.some(p => p.id === providerInfo.id)) {
    window.btc_providers.push(providerInfo);
  }
})();
