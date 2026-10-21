import { ChainType, type ChainBalance } from '@extension/backend/src/adapters/IChainAdapter';
import { Network, type BalanceData } from '@src/types';
import {
  buildTransactionExplorerUrl,
  getAssetDisplayPrecision,
  getContextBalanceForCurrency,
  getCurrencyMeta,
  getSendAmountPrecision,
  getTokenContractAddress,
  getTransactionHistoryOptionsForCurrency,
  isSupportedSendCurrency,
} from '@src/utils/currencyMeta';

const TX_HASH = '0xabc123';

describe('getCurrencyMeta', () => {
  it('describes ERC-20 tokens as Ethereum assets that pay fees in ETH', () => {
    const usdt = getCurrencyMeta('usdt');
    expect(usdt.chain).toBe(ChainType.Ethereum);
    expect(usdt.tokenSymbol).toBe('USDT');
    expect(usdt.networkFeeSymbol).toBe('ETH');
  });

  it('falls back to Bitcoin for an unknown or missing currency', () => {
    expect(getCurrencyMeta('doge').symbol).toBe('BTC');
    expect(getCurrencyMeta(undefined).symbol).toBe('BTC');
  });
});

describe('isSupportedSendCurrency', () => {
  it('accepts the currencies the send flow handles', () => {
    expect(isSupportedSendCurrency('btc')).toBe(true);
    expect(isSupportedSendCurrency('eth')).toBe(true);
    expect(isSupportedSendCurrency('usdt')).toBe(true);
  });

  it('rejects currencies the wallet only lists, and unknown ones', () => {
    expect(isSupportedSendCurrency('bch')).toBe(false);
    expect(isSupportedSendCurrency('doge')).toBe(false);
    expect(isSupportedSendCurrency(undefined)).toBe(false);
  });
});

describe('precision', () => {
  it('lets a token send carry more decimals than its balance shows', () => {
    expect(getAssetDisplayPrecision('usdt')).toBe(2);
    expect(getSendAmountPrecision('usdt')).toBe(6);
  });

  it('uses the display precision when no send precision is set', () => {
    expect(getSendAmountPrecision('btc')).toBe(8);
    expect(getSendAmountPrecision('eth')).toBe(6);
  });
});

describe('getContextBalanceForCurrency', () => {
  const btcBalance: BalanceData = { confirmed: 150_000_000, unconfirmed: 0, confirmedUsd: 0, unconfirmedUsd: 0 };
  const chainBalances: Partial<Record<ChainType, ChainBalance>> = {
    [ChainType.Ethereum]: {
      confirmed: 0.75,
      unconfirmed: 0,
      confirmedFiat: 0,
      unconfirmedFiat: 0,
      tokens: { USDT: { symbol: 'USDT', balance: 42.5, decimals: 6 } },
    },
  };

  it('converts the Bitcoin balance from sats', () => {
    expect(getContextBalanceForCurrency('btc', btcBalance, chainBalances)).toBe(1.5);
  });

  it('reads ETH and token balances from the Ethereum chain balance', () => {
    expect(getContextBalanceForCurrency('eth', btcBalance, chainBalances)).toBe(0.75);
    expect(getContextBalanceForCurrency('usdt', btcBalance, chainBalances)).toBe(42.5);
  });

  it('returns null while a balance has not loaded', () => {
    expect(getContextBalanceForCurrency('btc', undefined, chainBalances)).toBeNull();
    expect(getContextBalanceForCurrency('eth', btcBalance, {})).toBeNull();
    expect(getContextBalanceForCurrency('usdt', btcBalance, {})).toBeNull();
  });
});

describe('token lookups', () => {
  it('asks for token history only for tokens', () => {
    expect(getTransactionHistoryOptionsForCurrency('usdt')).toEqual({ tokenSymbol: 'USDT' });
    expect(getTransactionHistoryOptionsForCurrency('eth')).toBeUndefined();
  });

  it('resolves the token contract for the given network', () => {
    expect(getTokenContractAddress('usdt', Network.Mainnet)).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(getTokenContractAddress('eth', Network.Mainnet)).toBeUndefined();
  });
});

describe('buildTransactionExplorerUrl', () => {
  it('links ETH and token transactions on Blockscout for their network', () => {
    expect(buildTransactionExplorerUrl('eth', Network.Mainnet, TX_HASH)).toBe(
      `https://eth.blockscout.com/tx/${TX_HASH}`,
    );
    expect(buildTransactionExplorerUrl('usdt', Network.Mainnet, TX_HASH)).toBe(
      `https://eth.blockscout.com/tx/${TX_HASH}`,
    );
    expect(buildTransactionExplorerUrl('eth', Network.Testnet, TX_HASH)).toBe(
      `https://eth-sepolia.blockscout.com/tx/${TX_HASH}`,
    );
  });

  it('links Bitcoin transactions for their network', () => {
    expect(buildTransactionExplorerUrl('btc', Network.Testnet, 'abc')).toBe('https://mempool.space/testnet4/tx/abc');
    expect(buildTransactionExplorerUrl('btc', Network.Mainnet, 'abc')).toBe(
      'https://www.blockonomics.co/#/search?q=abc',
    );
  });
});
