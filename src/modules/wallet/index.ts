import * as bip39 from "bip39";
import { randomBytes } from "crypto";
import { encryptData, decryptData } from "../../utils/encryption";
import { db } from "../../db/indexedDB";

export async function createNewWallet(password: string): Promise<string> {
  const entropy = randomBytes(32);
  const mnemonic = bip39.entropyToMnemonic(entropy.toString("hex"));

  const enc = encryptData(mnemonic, password);
  const walletId = `wallet-${Date.now()}`;
  await db.wallets.add({ walletId, encryptedMnemonic: enc });
  return walletId;
}

export async function recoverWalletFromMnemonic(
  mnemonic: string,
  password: string
): Promise<{ walletId: string }> {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }
  const enc = encryptData(mnemonic, password);
  const walletId = `wallet-${Date.now()}`;
  await db.wallets.add({ walletId, encryptedMnemonic: enc });
  return { walletId };
}

export async function listWallets() {
  return db.wallets.toArray();
}

export async function getMnemonic(
  walletId: string,
  password: string
): Promise<string> {
  const record = await db.wallets.where("walletId").equals(walletId).first();
  if (!record) {
    throw new Error("Wallet not found");
  }
  return decryptData(record.encryptedMnemonic, password);
}
