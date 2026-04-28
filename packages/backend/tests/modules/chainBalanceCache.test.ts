import { resetChromeStorage } from '../helpers/chromeMock';
import { ChainBalanceCache } from '../../src/modules/chainBalanceCache';
import { ChainType, type ChainBalance } from '../../src/adapters/IChainAdapter';
import { Network } from '../../src/types/electrum';

const sampleBalance: ChainBalance = {
  confirmed: 1.5,
  unconfirmed: 0,
  confirmedFiat: 4500,
  unconfirmedFiat: 0,
  nativeFiatRate: 3000,
};

describe('ChainBalanceCache', () => {
  beforeEach(() => resetChromeStorage());

  it('returns null when nothing is stored for the scope', async () => {
    const cache = new ChainBalanceCache();
    const out = await cache.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xABC' });
    expect(out).toBeNull();
  });

  it('round-trips a balance through storage and in-memory cache', async () => {
    const cache = new ChainBalanceCache();
    await cache.set({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xABC' }, sampleBalance);
    const out = await cache.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xABC' });
    expect(out).toEqual(sampleBalance);
  });

  it('lowercases the address in the storage key (case-insensitive lookups)', async () => {
    const cache = new ChainBalanceCache();
    await cache.set({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xMixedCASE' }, sampleBalance);
    const fresh = new ChainBalanceCache();
    const out = await fresh.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xmixedcase' });
    expect(out).toEqual(sampleBalance);
  });

  it('separates entries across networks', async () => {
    const cache = new ChainBalanceCache();
    const a: ChainBalance = { ...sampleBalance, confirmed: 1 };
    const b: ChainBalance = { ...sampleBalance, confirmed: 2 };
    await cache.set({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, a);
    await cache.set({ chain: ChainType.Ethereum, network: Network.Testnet, address: '0xA' }, b);
    expect((await cache.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }))?.confirmed).toBe(
      1,
    );
    expect((await cache.get({ chain: ChainType.Ethereum, network: Network.Testnet, address: '0xA' }))?.confirmed).toBe(
      2,
    );
  });

  it('clear() wipes only chain_balance:* keys', async () => {
    const cache = new ChainBalanceCache();
    await chrome.storage.local.set({ keep_me: 'preserved' });
    await cache.set({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, sampleBalance);
    await cache.clear();
    const all = await chrome.storage.local.get(null);
    expect(all.keep_me).toBe('preserved');
    expect(Object.keys(all).some(k => k.startsWith('chain_balance:'))).toBe(false);
  });
});
