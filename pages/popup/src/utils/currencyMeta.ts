import { ChainType, type ChainBalance } from '@extension/backend/src/adapters/IChainAdapter';
import type { BalanceData, Currencies, Network } from '@src/types';

type CurrencyMeta = {
  chain: ChainType;
  icon: string;
  name: string;
  symbol: string;
  displayPrecision: number;
  sendPrecision?: number;
  tokenSymbol?: string;
  networkFeeSymbol?: string;
};

const CURRENCY_META: Record<Currencies, CurrencyMeta> = {
  btc: { icon: 'popup/btc_coin.svg', name: 'Bitcoin', symbol: 'BTC', chain: ChainType.Bitcoin, displayPrecision: 8 },
  bch: {
    icon: 'popup/bch_coin.svg',
    name: 'Bitcoin Cash',
    symbol: 'BCH',
    chain: ChainType.Bitcoin,
    displayPrecision: 8,
  },
  eth: { icon: 'popup/eth_coin.svg', name: 'Ethereum', symbol: 'ETH', chain: ChainType.Ethereum, displayPrecision: 6 },
  usdt: {
    icon: 'popup/usdt_coin.svg',
    name: 'USDT',
    symbol: 'USDT',
    chain: ChainType.Ethereum,
    displayPrecision: 2,
    sendPrecision: 6,
    tokenSymbol: 'USDT',
    networkFeeSymbol: 'ETH',
  },
};

export function getCurrencyMeta(currency?: string): CurrencyMeta {
  if (currency && currency in CURRENCY_META) {
    return CURRENCY_META[currency as Currencies];
  }

  return CURRENCY_META.btc;
}

export function isSupportedSendCurrency(currency?: string): currency is 'btc' | 'eth' | 'usdt' {
  return currency === 'btc' || currency === 'eth' || currency === 'usdt';
}

export function getContextBalanceForCurrency(
  currency: string | undefined,
  btcBalance?: BalanceData,
  chainBalances?: Partial<Record<ChainType, ChainBalance>>,
): number | null {
  const meta = getCurrencyMeta(currency);

  if (currency === 'btc') {
    if (!btcBalance) return null;
    return btcBalance.confirmed / 1e8;
  }

  if (meta.tokenSymbol) {
    return chainBalances?.[meta.chain]?.tokens?.[meta.tokenSymbol]?.balance ?? null;
  }

  if (meta.chain === ChainType.Ethereum) {
    return chainBalances?.[ChainType.Ethereum]?.confirmed ?? null;
  }

  return null;
}

export function getAssetDisplayPrecision(currency?: string): number {
  return getCurrencyMeta(currency).displayPrecision;
}

export function getSendAmountPrecision(currency?: string): number {
  const meta = getCurrencyMeta(currency);
  return meta.sendPrecision ?? meta.displayPrecision;
}

export function getTransactionHistoryOptionsForCurrency(currency?: string): { tokenSymbol: string } | undefined {
  const meta = getCurrencyMeta(currency);

  if (meta.tokenSymbol) {
    return { tokenSymbol: meta.tokenSymbol };
  }

  return undefined;
}

export function buildTransactionExplorerUrl(currency: string | undefined, network: Network, txHash: string): string {
  const meta = getCurrencyMeta(currency);

  if (meta.chain === ChainType.Ethereum) {
    const baseUrl = network === 'testnet' ? 'https://eth-sepolia.blockscout.com/tx/' : 'https://eth.blockscout.com/tx/';
    return `${baseUrl}${txHash}`;
  }

  return `https://www.blockonomics.co/#/search?q=${txHash}`;
}
