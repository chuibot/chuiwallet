import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { historyService } from '@extension/backend/src/modules/txHistoryService';
import { scanManager } from '@extension/backend/src/scanManager';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { accountManager } from '@extension/backend/src/accountManager';
import { BitcoinAdapter } from '@extension/backend/src/adapters/BitcoinAdapter';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
import { chainRegistry } from '@extension/backend/src/adapters/ChainRegistry';
import { EthereumAdapter } from '@extension/backend/src/adapters/EthereumAdapter';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';

let bootstrapPromise: Promise<void> | null = null;
let chainAdapterPromise: Promise<void> | null = null;

/**
 * Load persisted local state before handling any popup messages.
 * This avoids cold-start races where the popup asks for wallet/account state
 * before the background service worker has rehydrated storage-backed modules.
 */
export function ensureBackgroundBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await preferenceManager.init();
      await walletManager.init();
      await accountManager.init(preferenceManager.get().activeAccountIndex);
    })();
  }

  return bootstrapPromise;
}

/**
 * Register chain adapters before handling messages that depend on them.
 * This avoids cold-start races where wallet.restore / chain.* runs before
 * the background init path has registered Ethereum or Bitcoin adapters.
 */
export function ensureChainAdaptersReady(): Promise<void> {
  if (!chainAdapterPromise) {
    chainAdapterPromise = (async () => {
      await ensureBackgroundBootstrap();

      if (!chainRegistry.has(ChainType.Bitcoin)) {
        chainRegistry.register(new BitcoinAdapter(walletManager, electrumService, scanManager, historyService));
      }

      let ethAdapter = chainRegistry.get(ChainType.Ethereum) as EthereumAdapter | undefined;
      if (!ethAdapter) {
        ethAdapter = new EthereumAdapter({ rpcApiKey: preferenceManager.get().ethRpcApiKey });
        chainRegistry.register(ethAdapter);
      }

      await ethAdapter.init(preferenceManager.get().activeNetwork);

      const sessionPassword = await getSessionPassword();
      if (sessionPassword) {
        try {
          const mnemonic = await walletManager.getMnemonic(sessionPassword);
          if (mnemonic) {
            ethAdapter.initWithMnemonic(mnemonic, walletManager.getActiveAccountListIndex());
          }
        } catch (error) {
          console.warn('Failed to hydrate Ethereum adapter during bootstrap', error);
        }
      }
    })();
  }

  return chainAdapterPromise;
}
