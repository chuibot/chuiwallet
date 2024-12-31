import {
  createNewWallet,
  recoverWalletFromMnemonic,
  listWallets,
  getMnemonic,
} from "../../src/modules/wallet";
import * as bip39 from "bip39";

describe("Wallet Module Tests", () => {
  const PW = "test";

  it("creates a new wallet", async () => {
    const walletId = await createNewWallet(PW);
    expect(typeof walletId).toBe("string");
    const wallets = await listWallets();
    const found = wallets.find((w) => w.walletId === walletId);
    expect(found).toBeDefined();
  });

  it("recovers from valid mnemonic", async () => {
    const mnemonic = bip39.generateMnemonic(256);
    const { walletId } = await recoverWalletFromMnemonic(mnemonic, PW);
    const saved = await getMnemonic(walletId, PW);
    expect(saved).toBe(mnemonic);
  });

  it("throws error on invalid mnemonic", async () => {
    await expect(
      recoverWalletFromMnemonic("not valid words", PW)
    ).rejects.toThrow("Invalid mnemonic");
  });
});
