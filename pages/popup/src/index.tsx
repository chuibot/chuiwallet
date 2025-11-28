import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@src/index.css';
import { App } from './00_App/App';
import { WalletProvider } from './context/WalletContext';
import { BannerProvider } from './context/BannerContext';

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  root.render(
    <BannerProvider>
      <WalletProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </WalletProvider>
    </BannerProvider>,
  );
}

init();
