type PriceCacheEntry = {
  price: number;
  fetchedAt: number;
};

export class AssetPriceService {
  private static readonly PRICE_CACHE_MS = 60_000;

  private cache = new Map<string, PriceCacheEntry>();

  async getUsdPrice(assetId: string): Promise<number> {
    const prices = await this.getUsdPrices([assetId]);
    return prices[assetId] ?? 0;
  }

  async getUsdPrices(assetIds: string[]): Promise<Record<string, number>> {
    const now = Date.now();
    const normalizedIds = Array.from(
      new Set(assetIds.map(assetId => assetId.trim().toLowerCase()).filter(assetId => assetId.length > 0)),
    );

    if (normalizedIds.length === 0) {
      return {};
    }

    const prices: Record<string, number> = {};
    const missingIds: string[] = [];

    normalizedIds.forEach(assetId => {
      const cachedEntry = this.cache.get(assetId);
      if (cachedEntry && now - cachedEntry.fetchedAt < AssetPriceService.PRICE_CACHE_MS) {
        prices[assetId] = cachedEntry.price;
        return;
      }

      missingIds.push(assetId);
    });

    if (missingIds.length > 0) {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(missingIds.join(','))}&vs_currencies=usd`,
        );
        if (!response.ok) {
          throw new Error(`CoinGecko HTTP ${response.status}`);
        }

        const payload = (await response.json()) as Record<string, { usd?: number }>;
        missingIds.forEach(assetId => {
          const nextPrice = payload?.[assetId]?.usd;
          if (typeof nextPrice === 'number' && Number.isFinite(nextPrice) && nextPrice > 0) {
            this.cache.set(assetId, {
              price: nextPrice,
              fetchedAt: now,
            });
            prices[assetId] = nextPrice;
            return;
          }

          const staleEntry = this.cache.get(assetId);
          if (staleEntry) {
            prices[assetId] = staleEntry.price;
          }
        });
      } catch (error) {
        console.warn('Failed to fetch asset prices', error);
        missingIds.forEach(assetId => {
          const staleEntry = this.cache.get(assetId);
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
