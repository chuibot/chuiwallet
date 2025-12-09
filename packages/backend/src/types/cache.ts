export interface AddressEntry {
  address: string;
  firstSeen: number;
  lastChecked: number;
  everUsed: boolean;
}

export interface HistoryEntry {
  lastChecked: number; // timestamp of last fetch
  txs: Array<[string /*txid*/, number /*height*/]>;
}

export interface UtxoEntry {
  lastChecked: number;
  utxos: Array<{
    txid: string;
    vout: number;
    value: number; // sats
    height: number;
  }>;
}

export interface TxEntry {
  type: TxType;
  status: TxStatus;
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

export type TxStatus = 'PENDING' | 'CONFIRMED';
export type TxType = 'SEND' | 'RECEIVE';

export enum CacheType {
  Address = 'address',
  History = 'history',
  Utxo = 'utxo',
  Tx = 'tx',
}

export enum ChangeType {
  External = 'receive',
  Internal = 'change',
}

export type ScanUpdateType = 'init' | 'scan' | 'backfill' | 'clear';

export interface ScanEvent {
  type: ScanUpdateType;
  changeType: ChangeType;
  utxoChanged: boolean;
  historyChanged: boolean;
  indices?: number[];
  message?: string;
  data?: unknown;
}

export type ScanEventInput = Omit<ScanEvent, 'utxoChanged' | 'historyChanged'> &
  Partial<Pick<ScanEvent, 'utxoChanged' | 'historyChanged'>>;
