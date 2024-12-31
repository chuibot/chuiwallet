export interface BalanceResponse {
  confirmed: number;
  unconfirmed: number;
}

export interface HistoryItem {
  tx_hash: string;
  height: number;
  value?: number;
}
