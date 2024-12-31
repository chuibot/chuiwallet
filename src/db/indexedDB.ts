if (typeof indexedDB === "undefined") {
  require("fake-indexeddb/auto");
}

import Dexie from "dexie";

export interface DBWalletRecord {
  id?: number;
  walletId: string;
  encryptedMnemonic: string;
}

export interface DBSettingsRecord {
  id?: number;
  key: string;
  value: string; // JSON string
}

class ChuiDB extends Dexie {
  public wallets!: Dexie.Table<DBWalletRecord, number>;
  public settings!: Dexie.Table<DBSettingsRecord, number>;

  constructor() {
    super("ChuiWalletDB");
    this.version(1).stores({
      wallets: "++id,walletId,encryptedMnemonic",
      settings: "++id,key,value",
    });
  }
}

export const db = new ChuiDB();
