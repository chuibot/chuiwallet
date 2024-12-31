import * as bip39 from "bip39";
import * as bitcoin from "bitcoinjs-lib";
import { WalletSettings } from "../settings/walletSettings";
import { toXOnly } from "../taprootUtils";
import BIP32Factory from "bip32";

export function deriveAddress(
  mnemonic: string,
  accountIndex: number,
  addressIndex: number,
  isChange: boolean,
  settings: WalletSettings
): { address: string; derivationPath: string } {
  const netObj =
    settings.network === "mainnet"
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

  let purpose = 84;
  if (settings.addressType === "p2pkh") purpose = 44;
  else if (settings.addressType === "p2sh-p2wpkh") purpose = 49;
  else if (settings.addressType === "p2tr") purpose = 86;

  const coinType = settings.network === "mainnet" ? 0 : 1;
  const changeVal = isChange ? 1 : 0;
  const path = `m/${purpose}'/${coinType}'/${accountIndex}'/${changeVal}/${addressIndex}`;

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = BIP32Factory.fromSeed(seed, netObj);
  const child = root.derivePath(path);

  let payment: bitcoin.payments.Payment;
  if (settings.addressType === "p2pkh") {
    payment = bitcoin.payments.p2pkh({
      pubkey: child.publicKey,
      network: netObj,
    });
  } else if (settings.addressType === "p2sh-p2wpkh") {
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: child.publicKey,
      network: netObj,
    });
    payment = bitcoin.payments.p2sh({ redeem: p2wpkh, network: netObj });
  } else if (settings.addressType === "p2tr") {
    payment = bitcoin.payments.p2tr({
      internalPubkey: toXOnly(child.publicKey),
      network: netObj,
    });
  } else {
    payment = bitcoin.payments.p2wpkh({
      pubkey: child.publicKey,
      network: netObj,
    });
  }

  if (!payment.address) {
    throw new Error("Could not derive address");
  }

  return { address: payment.address, derivationPath: path };
}
