import * as bitcoin from "bitcoinjs-lib";
import * as bip39 from "bip39";
import { getMnemonic } from "../wallet";
import { getWalletSettings } from "../../settings/walletSettings";
import { toXOnly } from "../../taprootUtils";
import { scanAddressesUntilGapReached, UTXO } from "../../utils/scanning";
import { broadcastTransaction } from "../../electrum/electrumClient";
import BIP32Factory, { BIP32Interface } from "bip32";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";
import { Signer } from "bitcoinjs-lib";

const ECPair = ECPairFactory(ecc);

function u8ToBuffer(u8: Uint8Array): Buffer {
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

function bufferToU8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Creates a custom Signer for Taproot key-spend using `signSchnorr`.
 * `privKey` and `pubKey` should both be `Uint8Array`.
 */
export function createTaprootSigner(
  privKey: Uint8Array,
  pubKey: Uint8Array
): Signer {
  // For PSBT's interface, we need `publicKey` as a Node Buffer:
  const pubKeyBuf = u8ToBuffer(pubKey);

  return {
    publicKey: pubKeyBuf,
    sign: (hash: Buffer): Buffer => {
      // 1) Convert the `hash` (Buffer) -> Uint8Array
      const hashU8 = bufferToU8(hash);
      // 2) Perform Schnorr signing
      const signatureU8 = ecc.signSchnorr(hashU8, privKey);
      // 3) Convert the result back to Buffer for PSBT
      return u8ToBuffer(signatureU8);
    },
  };
}

export async function sendBitcoin(
  walletId: string,
  password: string,
  toAddress: string,
  amountSats: number,
  feeRate: number
): Promise<string> {
  // 1) Decrypt mnemonic
  const mnemonic = await getMnemonic(walletId, password);
  const settings = await getWalletSettings();
  const netObj =
    settings.network === "mainnet"
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

  // 2) Re-scan for addresses & UTXOs
  const scanRes = await scanAddressesUntilGapReached(walletId, password);
  const utxos = scanRes.allUTXOs;

  // 3) Sort largest -> smallest
  utxos.sort((a, b) => b.value - a.value);

  // 4) Build PSBT
  const psbt = new bitcoin.Psbt({ network: netObj });
  let totalInput = 0;
  const usedUtxos: UTXO[] = [];

  // 5) Add enough inputs
  for (const utxo of utxos) {
    if (totalInput >= amountSats) break;
    totalInput += utxo.value;

    psbt.addInput({
      hash: utxo.txId,
      index: utxo.vout,
      witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey, "hex"),
        value: utxo.value,
      },
    });
    usedUtxos.push(utxo);
  }
  if (totalInput < amountSats) {
    throw new Error("Not enough funds to cover requested amount.");
  }

  // 6) Add recipient output
  psbt.addOutput({ address: toAddress, value: amountSats });

  // 7) Fee + change
  const numInputs = psbt.data.inputs.length;
  const numOutputs = 2; // 1 user + 1 change
  const estSize = numInputs * 180 + numOutputs * 34 + 10;
  const fee = Math.ceil(estSize * feeRate);
  const change = totalInput - amountSats - fee;
  if (change < 0) {
    throw new Error("Insufficient funds after fee.");
  }

  if (change > 0) {
    if (!scanRes.addresses[0]) {
      throw new Error("No scanned addresses for change output");
    }
    const changeAddr = scanRes.addresses[0].address;
    psbt.addOutput({ address: changeAddr, value: change });
  }

  // 8) Derive + sign each input
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = BIP32Factory.fromSeed(seed, netObj);
  const { addressType } = settings;

  for (let i = 0; i < usedUtxos.length; i++) {
    const utxo = usedUtxos[i];
    if (!utxo.derivationPath) {
      throw new Error(
        `Missing derivationPath for UTXO at address=${utxo.address}`
      );
    }
    const child = root.derivePath(utxo.derivationPath);

    // 8.1) Build the correct payment if we need to attach redeemScript or tapInternalKey
    if (addressType === "p2pkh") {
      // No redeemScript needed
      const ecpair = ECPair.fromPrivateKey(u8ToBuffer(child.privateKey!), {
        network: netObj,
      });
      psbt.signInput(i, ecpair);
    } else if (addressType === "p2sh-p2wpkh") {
      // We build the redeem script for p2sh-wrapped segwit
      const ecpair = ECPair.fromPrivateKey(u8ToBuffer(child.privateKey!), {
        network: netObj,
      });
      const pubkey = ecpair.publicKey;
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: netObj });
      const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network: netObj });
      // Attach redeemScript
      psbt.updateInput(i, {
        redeemScript: p2sh.redeem?.output,
      });
      // sign
      psbt.signInput(i, ecpair);
    } else if (addressType === "p2tr") {
      // Single-sig Taproot, we do keypath spend
      // We must set tapInternalKey:
      psbt.updateInput(i, {
        tapInternalKey: toXOnly(child.publicKey!),
      });
      // Then sign with our schnorr signer
      const tapSigner = createTaprootSigner(
        child.privateKey!,
        child.publicKey!
      );
      psbt.signInput(i, tapSigner);
    } else {
      // p2wpkh as default
      // no redeemScript needed
      const ecpair = ECPair.fromPrivateKey(u8ToBuffer(child.privateKey!), {
        network: netObj,
      });
      psbt.signInput(i, ecpair);
    }
  }

  // 9) Finalize
  psbt.finalizeAllInputs();

  // 10) Broadcast
  const txHex = psbt.extractTransaction().toHex();
  const txId = await broadcastTransaction(txHex);
  return txId;
}
