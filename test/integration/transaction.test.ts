import {
  createNewWallet,
  recoverWalletFromMnemonic,
} from "../../src/modules/wallet";
import { setWalletSettings } from "../../src/settings/walletSettings";
import { getFeeEstimates } from "../../src/modules/transactions/fees";
import { sendBitcoin } from "../../src/modules/transactions/send";

describe("Transactions (Send) - Real Tests", () => {
  const PW = "tx-pass";
  const FUNDED_MNEMONIC = process.env.FUNDED_MNEMONIC || "";

  beforeAll(async () => {
    await setWalletSettings({ network: "testnet", addressType: "p2wpkh" });
  });

  it("fails to send if no UTXOs on brand new wallet", async () => {
    const wId = await createNewWallet(PW);
    const fees = await getFeeEstimates();

    // attempt to send 5000 sats
    await expect(
      sendBitcoin(
        wId,
        PW,
        "tb1qe2plk0ymkynhqlgar8c646d8j3stfjmdwlnfaq",
        5000,
        fees.mediumFeeRate
      )
    ).rejects.toThrow("Not enough funds");
  });

  it("sends real transaction if FUNDED_MNEMONIC is provided", async () => {
    if (!FUNDED_MNEMONIC) {
      console.warn("No FUNDED_MNEMONIC for real TX test. Skipping...");
      return;
    }
    // 1) recover funded wallet
    const { walletId } = await recoverWalletFromMnemonic(FUNDED_MNEMONIC, PW);
    // 2) get fee
    const fees = await getFeeEstimates();

    // 3) choose a random testnet receiving address (or your other test wallet)
    const RECIPIENT_ADDR = "tb1qe2plk0ymkynhqlgar8c646d8j3stfjmdwlnfaq.";

    // 4) attempt to send
    const txId = await sendBitcoin(
      walletId,
      PW,
      RECIPIENT_ADDR,
      1000,
      fees.mediumFeeRate
    );
    console.log("Successfully broadcasted TX:", txId);

    // If broadcast is successful, we expect a 64-char hex string
    expect(txId).toMatch(/^[0-9a-f]{64}$/);
  });
});
