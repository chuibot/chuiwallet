import type { ChainTransaction, ChainType } from '../adapters/IChainAdapter';
import type { Network } from '../types/electrum';
import browser from 'webextension-polyfill';

interface ChainHistoryScope {
  chain: ChainType;
  network: Network;
  address: string;
  assetKey?: string;
}

export class ChainTransactionHistoryCache {
  private static readonly STORAGE_KEY_PREFIX = 'chain_tx_history:';

  private caches = new Map<string, Map<string, ChainTransaction>>();

  async get(scope: ChainHistoryScope): Promise<ChainTransaction[]> {
    const cache = await this.load(scope);
    return this.sortTransactions(Array.from(cache.values()));
  }

  async merge(scope: ChainHistoryScope, latestTransactions: ChainTransaction[]): Promise<ChainTransaction[]> {
    const cache = await this.load(scope);

    latestTransactions.forEach(transaction => {
      if (!transaction.hash) {
        return;
      }

      cache.set(transaction.hash.toLowerCase(), transaction);
    });

    await this.save(scope, cache);
    return this.sortTransactions(Array.from(cache.values()));
  }

  async clear(): Promise<void> {
    this.caches.clear();

    const storedEntries = await browser.storage.local.get(null);
    const cacheKeys = Object.keys(storedEntries).filter(key =>
      key.startsWith(ChainTransactionHistoryCache.STORAGE_KEY_PREFIX),
    );

    if (cacheKeys.length > 0) {
      await browser.storage.local.remove(cacheKeys);
    }
  }

  private async load(scope: ChainHistoryScope): Promise<Map<string, ChainTransaction>> {
    const cacheKey = this.getStorageKey(scope);
    const existingCache = this.caches.get(cacheKey);
    if (existingCache) {
      return existingCache;
    }

    const storedHistory = await browser.storage.local.get(cacheKey);
    const transactions = new Map<string, ChainTransaction>();
    const serializedEntries = (storedHistory[cacheKey] as [string, ChainTransaction][]) ?? [];

    serializedEntries.forEach(([hash, transaction]) => {
      if (!hash || !transaction) {
        return;
      }

      transactions.set(hash, transaction);
    });

    this.caches.set(cacheKey, transactions);
    return transactions;
  }

  private async save(scope: ChainHistoryScope, cache: Map<string, ChainTransaction>): Promise<void> {
    const cacheKey = this.getStorageKey(scope);
    await browser.storage.local.set({
      [cacheKey]: Array.from(cache.entries()),
    });
  }

  private getStorageKey(scope: ChainHistoryScope): string {
    const assetSegment = scope.assetKey ? `:${scope.assetKey.toLowerCase()}` : '';
    return `${ChainTransactionHistoryCache.STORAGE_KEY_PREFIX}${scope.chain}:${scope.network}:${scope.address.toLowerCase()}${assetSegment}`;
  }

  private sortTransactions(transactions: ChainTransaction[]): ChainTransaction[] {
    return [...transactions].sort((left, right) => right.timestamp - left.timestamp);
  }
}

export const chainTransactionHistoryCache = new ChainTransactionHistoryCache();
