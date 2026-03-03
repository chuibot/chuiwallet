import { ChainType, type ChainBalance } from '@extension/backend/src/adapters/IChainAdapter';
import type { BalanceData, Currencies, Network } from '@src/types';

type CurrencyMeta = {
  chain: ChainType;
  icon: string;
  name: string;
  symbol: string;
};

const CURRENCY_META: Record<Currencies, CurrencyMeta> = {
  btc: { icon: 'popup/btc_coin.svg', name: 'Bitcoin', symbol: 'BTC', chain: ChainType.Bitcoin },
  bch: { icon: 'popup/bch_coin.svg', name: 'Bitcoin Cash', symbol: 'BCH', chain: ChainType.Bitcoin },
  eth: { icon: 'popup/eth_coin.svg', name: 'Ethereum', symbol: 'ETH', chain: ChainType.Ethereum },
  usdt: { icon: 'popup/usdt_coin.svg', name: 'USDT', symbol: 'USDT', chain: ChainType.Ethereum },
};

export function getCurrencyMeta(currency?: string): CurrencyMeta {
  if (currency && currency in CURRENCY_META) {
    return CURRENCY_META[currency as Currencies];
  }

  return CURRENCY_META.btc;
}

export function isSupportedSendCurrency(currency?: string): currency is 'btc' | 'eth' {
  return currency === 'btc' || currency === 'eth';
}

export function getContextBalanceForCurrency(
  currency: string | undefined,
  btcBalance?: BalanceData,
  chainBalances?: Partial<Record<ChainType, ChainBalance>>,
): number | null {
  if (currency === 'btc') {
    if (!btcBalance) return null;
    return btcBalance.confirmed / 1e8;
  }

  if (currency === 'eth') {
    return chainBalances?.[ChainType.Ethereum]?.confirmed ?? null;
  }

  if (currency === 'usdt') {
    return chainBalances?.[ChainType.Ethereum]?.tokens?.USDT?.balance ?? null;
  }

  return null;
}

export function getAssetDisplayPrecision(currency?: string): number {
  return currency === 'btc' ? 8 : 6;
}

export function buildTransactionExplorerUrl(currency: string | undefined, network: Network, txHash: string): string {
  if (currency === 'eth' || currency === 'usdt') {
    const baseUrl = network === 'testnet' ? 'https://eth-sepolia.blockscout.com/tx/' : 'https://eth.blockscout.com/tx/';
    return `${baseUrl}${txHash}`;
  }

  return `https://www.blockonomics.co/#/search?q=${txHash}`;
}
