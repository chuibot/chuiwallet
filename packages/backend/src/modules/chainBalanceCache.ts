import type { ChainBalance, ChainType } from '../adapters/IChainAdapter';
import type { Network } from '../types/electrum';
import browser from 'webextension-polyfill';

interface ChainBalanceScope {
  chain: ChainType;
  network: Network;
  address: string;
}

export class ChainBalanceCache {
  private static readonly STORAGE_KEY_PREFIX = 'chain_balance:';

  private caches = new Map<string, ChainBalance>();

  async get(scope: ChainBalanceScope): Promise<ChainBalance | null> {
    const cacheKey = this.getStorageKey(scope);
    const existingCache = this.caches.get(cacheKey);
    if (existingCache) {
      return existingCache;
    }

    const storedBalance = await browser.storage.local.get(cacheKey);
    const balance = storedBalance[cacheKey];
    if (!balance || typeof balance !== 'object') {
      return null;
    }

    const typedBalance = balance as ChainBalance;
    this.caches.set(cacheKey, typedBalance);
    return typedBalance;
  }

  async set(scope: ChainBalanceScope, balance: ChainBalance): Promise<void> {
    const cacheKey = this.getStorageKey(scope);
    this.caches.set(cacheKey, balance);
    await browser.storage.local.set({
      [cacheKey]: balance,
    });
  }

  async clear(): Promise<void> {
    this.caches.clear();

    const storedEntries = await browser.storage.local.get(null);
    const cacheKeys = Object.keys(storedEntries).filter(key => key.startsWith(ChainBalanceCache.STORAGE_KEY_PREFIX));

    if (cacheKeys.length > 0) {
      await browser.storage.local.remove(cacheKeys);
    }
  }

  private getStorageKey(scope: ChainBalanceScope): string {
    return `${ChainBalanceCache.STORAGE_KEY_PREFIX}${scope.chain}:${scope.network}:${scope.address.toLowerCase()}`;
  }
}

export const chainBalanceCache = new ChainBalanceCache();
