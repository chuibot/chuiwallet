import type { RpcErrorResponse, RpcRequest, RpcResponse } from '@src/background/router/rpc';

function addChuiToPage() {
  const inpage = document.createElement('script');
  inpage.src = chrome.runtime.getURL('inpage/chuiProvider.js');
  inpage.id = 'chui-provider';
  document.body.appendChild(inpage);
}

requestAnimationFrame(() => addChuiToPage());

window.addEventListener('message', event => {
  if (
    event.source !== window ||
    !event.data ||
    event.data.source !== 'chui-inpage' ||
    event.data.type !== 'CHUI_BTC_RPC_REQUEST'
  ) {
    return;
  }

  const rpcRequest = event.data.payload as RpcRequest;
  chrome.runtime.sendMessage(
    {
      type: 'PROVIDER_RPC',
      params: rpcRequest,
      origin: window.location.origin,
    },
    response => {
      let rpcResponse: RpcResponse;

      if (chrome.runtime.lastError || !response) {
        rpcResponse = {
          jsonrpc: '2.0',
          id: rpcRequest.id,
          error: {
            code: -32000,
            message: chrome.runtime.lastError?.message ?? 'Extension transport error',
          },
        } as RpcErrorResponse;
      } else {
        rpcResponse = response;
      }

      window.postMessage(
        {
          source: 'chui-content-script',
          type: 'CHUI_BTC_RPC_RESPONSE',
          payload: rpcResponse,
        },
        '*',
      );
    },
  );
});
