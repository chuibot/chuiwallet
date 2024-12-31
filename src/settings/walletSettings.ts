import { db } from "../db/indexedDB";
import { DEFAULT_GAP_LIMIT, MAX_ADDRESSES } from "../config";

export interface WalletSettings {
  network: "mainnet" | "testnet";
  addressType: "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr";
  gapLimit: number;
  maxAddresses: number;
}

// Default config
const defaultSettings: WalletSettings = {
  network: "testnet",
  addressType: "p2wpkh",
  gapLimit: DEFAULT_GAP_LIMIT,
  maxAddresses: MAX_ADDRESSES,
};

/**
 * Save user settings to Dexie
 */
export async function setWalletSettings(
  settings: Partial<WalletSettings>
): Promise<void> {
  // get existing
  let record = await db.settings.where("key").equals("userSettings").first();
  let current: WalletSettings = { ...defaultSettings };

  if (record) {
    current = JSON.parse(record.value) as WalletSettings;
  } else {
    record = { key: "userSettings", value: "" };
  }

  const updated = { ...current, ...settings };
  record.value = JSON.stringify(updated);

  if (record.id) {
    await db.settings.update(record.id, { value: record.value });
  } else {
    await db.settings.add(record);
  }
}

/**
 * Load user settings from Dexie. If none, use defaults.
 */
export async function getWalletSettings(): Promise<WalletSettings> {
  const record = await db.settings.where("key").equals("userSettings").first();
  if (!record) {
    // no saved settings
    return { ...defaultSettings };
  }
  return JSON.parse(record.value) as WalletSettings;
}
