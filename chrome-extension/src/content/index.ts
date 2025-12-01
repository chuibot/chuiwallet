// 1) Inject the inpage script so it runs in the page world
function addChuiToPage() {
  console.log('try');
  const inpage = document.createElement('script');
  inpage.src = chrome.runtime.getURL('chuiProvider.ts');
  inpage.id = 'chui-provider';
  document.body.appendChild(inpage);
}

requestAnimationFrame(() => addChuiToPage());

// function addLeatherToPage() {
//   const inpage = document.createElement('script');
//   inpage.src = chrome.runtime.getURL('inpage.js');
//   inpage.id = 'leather-provider';
//   document.body.appendChild(inpage);
// }
//
// // Don't block thread to add Leather to page
// requestAnimationFrame(() => addLeatherToPage());

// 2) Bridge page <-> background
window.addEventListener('message', event => {
  if (
    event.source !== window ||
    !event.data ||
    event.data.source !== 'chui-inpage' ||
    event.data.type !== 'CHUI_BTC_RPC_REQUEST'
  ) {
    return;
  }

  const { id, method, params } = event.data;

  chrome.runtime.sendMessage(
    {
      type: 'CHUI_BTC_RPC_REQUEST',
      method,
      params,
      origin: window.location.origin,
    },
    response => {
      if (chrome.runtime.lastError) {
        window.postMessage(
          {
            source: 'chui-content-script',
            type: 'CHUI_BTC_RPC_RESPONSE',
            id,
            error: chrome.runtime.lastError.message,
          },
          '*',
        );
        return;
      }

      window.postMessage(
        {
          source: 'chui-content-script',
          type: 'CHUI_BTC_RPC_RESPONSE',
          id,
          result: response?.result ?? null,
          error: response?.error ?? null,
        },
        '*',
      );
    },
  );
});
