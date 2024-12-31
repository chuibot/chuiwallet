import {
  createNewWallet,
  recoverWalletFromMnemonic,
  listWallets,
} from "./modules/wallet";
import {
  setWalletSettings,
  getWalletSettings,
} from "./settings/walletSettings";
import { scanAddressesUntilGapReached } from "./utils/scanning";
import {
  getFullWalletBalance,
  getFullWalletHistory,
  broadcastTransaction,
} from "./electrum/electrumClient";
import { getFeeEstimates } from "./modules/transactions/fees";
import { sendBitcoin } from "./modules/transactions/send";

// This is to test core functionalities, and will integrate it into UI later
(async function mainApp() {
  // Set user settings (testnet, p2tr, etc.)
  await setWalletSettings({ network: "testnet", addressType: "p2tr" });

  // Create a new wallet
  const walletId = await createNewWallet("test");
  console.log("New wallet:", walletId);

  // Check we can recover an existing wallet
  // await recoverWalletFromMnemonic('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'test');

  // See all wallets
  const all = await listWallets();
  console.log("All wallets in DB:", all);

  // Perform scanning
  const scanRes = await scanAddressesUntilGapReached(walletId, "test");
  console.log(
    `Derived ${scanRes.addresses.length} addresses, found ${scanRes.allUTXOs.length} UTXOs.`
  );

  // Get full balance & history
  const balance = await getFullWalletBalance(walletId, "test");
  console.log("Total Balance (confirmed+unconfirmed):", balance);

  const history = await getFullWalletHistory(walletId, "test");
  console.log("Full Transaction History:", history);

  // Fee Estimation
  const fees = await getFeeEstimates();
  console.log("Fee estimates:", fees);

  // Send BTC
  /*
  const txId = await sendBitcoin(
    walletId,
    'test',
    'tb1qRecipientAddress...',
    15000, // 15000 sats
    fees.mediumFeeRate
  );
  console.log('Broadcasted tx:', txId);
  */
})();
