import {
  getFullWalletBalance,
  getFullWalletHistory,
  broadcastTransaction,
} from "../../src/electrum/electrumClient";
import {
  createNewWallet,
  recoverWalletFromMnemonic,
} from "../../src/modules/wallet";
import { setWalletSettings } from "../../src/settings/walletSettings";

describe("Electrum Client (Real Usage)", () => {
  const PW = "electrum-pass";

  // Option A) Put a known funded mnemonic in an env var, or directly in test for convenience
  const FUNDED_MNEMONIC = process.env.FUNDED_MNEMONIC || "";

  beforeAll(async () => {
    // set to testnet
    await setWalletSettings({ network: "testnet", addressType: "p2wpkh" });
  });

  it("fails to broadcast invalid tx", async () => {
    await expect(broadcastTransaction("00ABCDEF")).rejects.toThrow();
  });

  it("can get balance and history for a brand new wallet (0 balance)", async () => {
    const newWalletId = await createNewWallet(PW);
    const balance = await getFullWalletBalance(newWalletId, PW);
    expect(balance).toBe(0);

    const history = await getFullWalletHistory(newWalletId, PW);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(0);
  });

  it("recovers a funded wallet if mnemonic is provided", async () => {
    if (!FUNDED_MNEMONIC) {
      console.warn(
        "No FUNDED_MNEMONIC provided, skipping funded wallet test..."
      );
      return;
    }
    // recover funded wallet
    const { walletId } = await recoverWalletFromMnemonic(FUNDED_MNEMONIC, PW);

    const balance = await getFullWalletBalance(walletId, PW);
    console.log(`Funded wallet balance: ${balance} satoshis`);
    expect(balance).toBeGreaterThan(0);

    const history = await getFullWalletHistory(walletId, PW);
    console.log("History:", history);
    expect(history.length).toBeGreaterThan(0);
  });
});
