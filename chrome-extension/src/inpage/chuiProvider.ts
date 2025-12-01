(function () {
  if (window.ChuiWalletProvider) {
    return;
  }

  console.log('injecting ...');
  window.ChuiWalletProvider = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    request: async function (method, params) {
      if (method === 'getXpub') {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'openXpub' }, response => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            resolve(response?.xpub || null);
          });
        });
      }

      return Promise.reject(new Error(`Method ${method} is not supported`));
    },
  };
})();
