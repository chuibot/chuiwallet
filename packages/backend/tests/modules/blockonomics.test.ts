import {
  installFetchMock,
  jsonResponse,
  mockFetch,
  resetFetchMock,
  restoreFetch,
  getFetchCalls,
} from '../helpers/fetchMock';
import { getBitcoinPrice } from '../../src/modules/blockonomics';

describe('getBitcoinPrice', () => {
  beforeAll(() => installFetchMock());
  afterAll(() => restoreFetch());
  beforeEach(() => resetFetchMock());

  it('defaults to USD and returns the parsed price', async () => {
    mockFetch('blockonomics.co/api/price', () => jsonResponse({ price: 65000 }));
    const price = await getBitcoinPrice();
    expect(price).toBe(65000);
    expect(getFetchCalls()[0].url).toContain('currency=USD');
  });

  it('passes the provided currency through to the URL', async () => {
    mockFetch('currency=EUR', () => jsonResponse({ price: 60000 }));
    await getBitcoinPrice('EUR');
    expect(getFetchCalls()[0].url).toMatch(/currency=EUR/);
  });

  it('returns undefined when the response payload has no price', async () => {
    mockFetch('blockonomics', () => jsonResponse({}));
    expect(await getBitcoinPrice()).toBeUndefined();
  });
});
