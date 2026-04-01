type PriceCacheEntry = {
  price: number;
  fetchedAt: number;
};

export class AssetPriceService {
  private static readonly PRICE_CACHE_MS = 60_000;

  private cache = new Map<string, PriceCacheEntry>();

  /** Build a cache key that includes the vs_currency so switching currencies doesn't return stale data */
  private cacheKey(assetId: string, vsCurrency: string): string {
    return `${assetId}:${vsCurrency}`;
  }

  async getUsdPrice(assetId: string): Promise<number> {
    const prices = await this.getUsdPrices([assetId]);
    return prices[assetId] ?? 0;
  }

  async getUsdPrices(assetIds: string[], vsCurrency: string = 'usd'): Promise<Record<string, number>> {
    const now = Date.now();
    const vs = vsCurrency.toLowerCase();
    const normalizedIds = Array.from(
      new Set(assetIds.map(assetId => assetId.trim().toLowerCase()).filter(assetId => assetId.length > 0)),
    );

    if (normalizedIds.length === 0) {
      return {};
    }

    const prices: Record<string, number> = {};
    const missingIds: string[] = [];

    normalizedIds.forEach(assetId => {
      const cachedEntry = this.cache.get(this.cacheKey(assetId, vs));
      if (cachedEntry && now - cachedEntry.fetchedAt < AssetPriceService.PRICE_CACHE_MS) {
        prices[assetId] = cachedEntry.price;
        return;
      }

      missingIds.push(assetId);
    });

    if (missingIds.length > 0) {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(missingIds.join(','))}&vs_currencies=${vs}`,
        );
        if (!response.ok) {
          throw new Error(`CoinGecko HTTP ${response.status}`);
        }

        const payload = (await response.json()) as Record<string, Record<string, number | undefined>>;
        missingIds.forEach(assetId => {
          const nextPrice = payload?.[assetId]?.[vs];
          if (typeof nextPrice === 'number' && Number.isFinite(nextPrice) && nextPrice > 0) {
            this.cache.set(this.cacheKey(assetId, vs), {
              price: nextPrice,
              fetchedAt: now,
            });
            prices[assetId] = nextPrice;
            return;
          }

          const staleEntry = this.cache.get(this.cacheKey(assetId, vs));
          if (staleEntry) {
            prices[assetId] = staleEntry.price;
          }
        });
      } catch (error) {
        console.warn('Failed to fetch asset prices', error);
        missingIds.forEach(assetId => {
          const staleEntry = this.cache.get(this.cacheKey(assetId, vs));
          if (staleEntry) {
            prices[assetId] = staleEntry.price;
          }
        });
      }
    }

    return prices;
  }
}

export const assetPriceService = new AssetPriceService();
