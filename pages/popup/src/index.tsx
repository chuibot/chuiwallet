import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@src/index.css';
import { App } from '@src/app/App';
import { WalletProvider } from './context/WalletContext';
import { ErrorProvider } from './context/ErrorContext';

// Browser-action popups use the designed 375 × 600 canvas. Provider approvals
// open in a separately sized native window and must instead fill its viewport.
if (window.location.hash.startsWith('#/provider/approve')) {
  document.documentElement.classList.add('provider-approval');
}

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  root.render(
    <ErrorProvider>
      <WalletProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </WalletProvider>
    </ErrorProvider>,
  );
}

init();
