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
  blockHeight?: number;
}

export interface ElectrumVin {
  txid: string;
  vout: number;
  sequence: number;
  // Optional fields if Electrum server enriches
  addresses?: string[];
  value?: number; // in sats
}

export interface ElectrumVout {
  value: number; // sats
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    type: string;
    address: string;
    addresses?: string[];
  };
}

export interface ElectrumTransaction {
  txid: string;
  hex: string;
  version: number;
  locktime: number;
  vin: ElectrumVin[];
  vout: ElectrumVout[];
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export type ElectrumHistoryItem = {
  tx_hash: string; // some servers use tx_hash
  height: number;
  fee?: number;
};
export type ElectrumHistory = ElectrumHistoryItem[];

export type ElectrumUtxo = {
  tx_hash: string;
  tx_pos: number;
  height: number;
  value: number; // sats
};

export interface FeeOptionSetting {
  speed: string;
  sats: number;
  btcAmount: number;
  usdAmount: number;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'error';

export interface ConnectionUpdate {
  detail?: string;
  status: ConnectionStatus;
  reason?: string;
  ts: number;
}
