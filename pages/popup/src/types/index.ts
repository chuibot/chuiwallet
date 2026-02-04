export type Currencies = 'btc' | 'bch' | 'usdt';

export const currencyMapping: Record<Currencies, string> = {
  btc: 'Bitcoin',
  bch: 'Bitcoin Cash',
  usdt: 'USDT',
};

export enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
}

export interface Preferences {
  gapLimitReceive: number;
  gapLimitChange: number;
  locale: string;
  fiatCurrency: string;
  activeAccountIndex: number; // Index into account list (accountManager.accounts), not HD account index
  activeNetwork: Network;
  isWalletBackedUp: boolean;
}

export interface BalanceData {
  confirmed: number;
  unconfirmed: number;
  confirmedUsd: number;
  unconfirmedUsd: number;
}
