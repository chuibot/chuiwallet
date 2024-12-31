declare module "electrum-client" {
  export default class ElectrumClient {
    constructor(port: number, host: string, protocol: string);
    connect(clientName: string, version: string): Promise<void>;
    close(): Promise<void>;

    blockchainScripthash_listunspent(scripthash: string): Promise<
      Array<{
        tx_hash: string;
        tx_pos: number;
        height: number;
        value: number;
      }>
    >;

    blockchainScripthash_getBalance(scripthash: string): Promise<{
      confirmed: number;
      unconfirmed: number;
    }>;

    blockchainScripthash_getHistory(scripthash: string): Promise<
      Array<{
        tx_hash: string;
        height: number;
        value?: number;
      }>
    >;

    blockchainTransaction_broadcast(rawTxHex: string): Promise<string>;
  }
}
