import { accountManager } from '@extension/backend/src/accountManager';
import { preferenceManager } from '@extension/backend/src/preferenceManager';
import { walletManager } from '@extension/backend/src/walletManager';

let bootstrapPromise: Promise<void> | null = null;

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
