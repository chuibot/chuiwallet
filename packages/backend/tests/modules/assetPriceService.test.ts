import {
  installFetchMock,
  jsonResponse,
  mockFetch,
  resetFetchMock,
  restoreFetch,
  getFetchCalls,
} from '../helpers/fetchMock';
import { AssetPriceService } from '../../src/modules/assetPriceService';

describe('AssetPriceService', () => {
  beforeAll(() => installFetchMock());
  afterAll(() => restoreFetch());
  beforeEach(() => resetFetchMock());

  it('fetches and returns prices for the requested ids', async () => {
    mockFetch('coingecko.com', () =>
      jsonResponse({
        ethereum: { usd: 3000 },
        tether: { usd: 1 },
      }),
    );
    const svc = new AssetPriceService();
    const prices = await svc.getUsdPrices(['ethereum', 'tether']);
    expect(prices).toEqual({ ethereum: 3000, tether: 1 });
  });

  it('caches results within the TTL window (single fetch on repeat call)', async () => {
    let count = 0;
    mockFetch('coingecko.com', () => {
      count++;
      return jsonResponse({ ethereum: { usd: 3000 } });
    });
    const svc = new AssetPriceService();
    await svc.getUsdPrices(['ethereum']);
    await svc.getUsdPrices(['ethereum']);
    expect(count).toBe(1);
  });

  it('keys the cache by vs_currency to prevent cross-currency staleness', async () => {
    mockFetch(/vs_currencies=usd/, () => jsonResponse({ ethereum: { usd: 3000 } }));
    mockFetch(/vs_currencies=eur/, () => jsonResponse({ ethereum: { eur: 2700 } }));
    const svc = new AssetPriceService();
    expect((await svc.getUsdPrices(['ethereum'], 'usd')).ethereum).toBe(3000);
    expect((await svc.getUsdPrices(['ethereum'], 'eur')).ethereum).toBe(2700);
  });

  it('returns empty map when given no ids', async () => {
    const svc = new AssetPriceService();
    expect(await svc.getUsdPrices([])).toEqual({});
    expect(getFetchCalls()).toHaveLength(0);
  });

  it('falls back to stale cache on network error', async () => {
    let firstCall = true;
    mockFetch('coingecko.com', () => {
      if (firstCall) {
        firstCall = false;
        return jsonResponse({ ethereum: { usd: 3000 } });
      }
      throw new Error('network down');
    });
    const svc = new AssetPriceService();
    await svc.getUsdPrices(['ethereum']);
    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;
    try {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await svc.getUsdPrices(['ethereum']);
      expect(result.ethereum).toBe(3000);
      warnSpy.mockRestore();
    } finally {
      Date.now = realNow;
    }
  });

  it('deduplicates and lowercases ids', async () => {
    let lastUrl = '';
    mockFetch('coingecko.com', url => {
      lastUrl = url;
      return jsonResponse({ ethereum: { usd: 3000 } });
    });
    const svc = new AssetPriceService();
    await svc.getUsdPrices(['Ethereum', 'ethereum', '  ETHEREUM  ']);
    expect(lastUrl).toContain('ids=ethereum');
    expect((lastUrl.match(/ethereum/g) ?? []).length).toBe(1);
  });

  it('getUsdPrice returns 0 when the id is missing from the payload', async () => {
    mockFetch('coingecko.com', () => jsonResponse({}));
    const svc = new AssetPriceService();
    expect(await svc.getUsdPrice('nonexistent')).toBe(0);
  });

  it('non-OK HTTP status falls through (warn + empty result)', async () => {
    mockFetch('coingecko.com', () => new Response('rate limited', { status: 429 }));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new AssetPriceService();
    expect(await svc.getUsdPrices(['ethereum'])).toEqual({});
    warnSpy.mockRestore();
  });
});
