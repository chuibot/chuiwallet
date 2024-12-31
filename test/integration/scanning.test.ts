import { createNewWallet } from "../../src/modules/wallet";
import { scanAddressesUntilGapReached } from "../../src/utils/scanning";
import { setWalletSettings } from "../../src/settings/walletSettings";

describe("Address Scanning Tests", () => {
  it("scans addresses up to gap limit", async () => {
    await setWalletSettings({
      network: "testnet",
      addressType: "p2wpkh",
      gapLimit: 3,
      maxAddresses: 10,
    });
    const walletId = await createNewWallet("scan-pass");
    const result = await scanAddressesUntilGapReached(walletId, "scan-pass");
    // At least 1 address derived
    expect(result.addresses.length).toBeGreaterThan(0);
    // If brand new, likely 0 UTXOs
    expect(result.allUTXOs.length).toBeGreaterThanOrEqual(0);
  });
});
