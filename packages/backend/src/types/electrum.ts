export enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
}

export enum DefaultPort {
  TCP = 50001,
  TLS = 50002,
}

export type ServerConfig = {
  host: string;
  port: number;
  useTls: boolean;
  network: Network;
};

export interface ExtendedServerConfig extends ServerConfig {
  latency?: number;
  healthy?: boolean;
}

export type TransactionActivityStatus = 'PENDING' | 'CONFIRMED';
export type TransactionType = 'SEND' | 'RECEIVE';

export interface TransactionActivity {
  type: TransactionType;
  status: TransactionActivityStatus;
  amountBtc: number;
  amountUsd: number;
  feeBtc: number;
  feeUsd: number;
  timestamp: number;
  confirmations: number;
  transactionHash: string;
  sender: string;
  receiver: string;
}

export interface FeeOptionSetting {
  speed: string;
  sats: number;
  btcAmount: number;
  usdAmount: number;
}
