import { resetChromeStorage } from '../helpers/chromeMock';
import { ChainTransactionHistoryCache } from '../../src/modules/chainTransactionHistoryCache';
import { ChainType, type ChainTransaction } from '../../src/adapters/IChainAdapter';
import { Network } from '../../src/types/electrum';

const tx = (hash: string, timestamp: number, status: ChainTransaction['status'] = 'confirmed'): ChainTransaction => ({
  hash,
  from: '0xSender',
  to: '0xReceiver',
  amount: 1,
  fee: 0.001,
  timestamp,
  confirmations: 6,
  status,
  chain: ChainType.Ethereum,
});

describe('ChainTransactionHistoryCache', () => {
  beforeEach(() => resetChromeStorage());

  it('returns empty array when no history is cached', async () => {
    const cache = new ChainTransactionHistoryCache();
    expect(await cache.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' })).toEqual([]);
  });

  it('merge() inserts and persists transactions, sorted newest-first', async () => {
    const cache = new ChainTransactionHistoryCache();
    const merged = await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, [
      tx('0x1', 100),
      tx('0x2', 300),
      tx('0x3', 200),
    ]);
    expect(merged.map(t => t.hash)).toEqual(['0x2', '0x3', '0x1']);
  });

  it('merge() updates an existing entry by hash (latest wins)', async () => {
    const cache = new ChainTransactionHistoryCache();
    await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, [
      tx('0x1', 100, 'pending'),
    ]);
    const merged = await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, [
      tx('0x1', 100, 'confirmed'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('confirmed');
  });

  it('skips entries with missing hash', async () => {
    const cache = new ChainTransactionHistoryCache();
    const merged = await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, [
      { ...tx('0x1', 100) },
      { ...tx('', 200) },
    ]);
    expect(merged.map(t => t.hash)).toEqual(['0x1']);
  });

  it('separates entries by assetKey for token vs native history', async () => {
    const cache = new ChainTransactionHistoryCache();
    await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, [tx('0xnative', 1)]);
    await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA', assetKey: 'usdt' }, [
      tx('0xtoken', 2),
    ]);
    expect(
      (await cache.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' })).map(t => t.hash),
    ).toEqual(['0xnative']);
    expect(
      (await cache.get({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA', assetKey: 'usdt' })).map(
        t => t.hash,
      ),
    ).toEqual(['0xtoken']);
  });

  it('clear() removes only chain_tx_history:* keys', async () => {
    const cache = new ChainTransactionHistoryCache();
    await chrome.storage.local.set({ unrelated: 'keep' });
    await cache.merge({ chain: ChainType.Ethereum, network: Network.Mainnet, address: '0xA' }, [tx('0x1', 1)]);
    await cache.clear();
    const all = await chrome.storage.local.get(null);
    expect(all.unrelated).toBe('keep');
    expect(Object.keys(all).some(k => k.startsWith('chain_tx_history:'))).toBe(false);
  });
});
