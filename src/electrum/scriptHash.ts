import * as bitcoin from "bitcoinjs-lib";
import { createHash } from "crypto";

export function addressToScriptHash(
  address: string,
  network: bitcoin.networks.Network
): string {
  // We'll decode the address. But for P2PKH or P2SH (which are base58),
  // fromBech32 throws an error. So we do a detection approach.

  // P2PKH => base58Check starts with '1' or 'm/n'
  // P2SH => base58Check starts with '3' or '2'
  // P2WPKH => bech32
  // P2TR => bech32
  // We'll do a try-catch for bech32 decode, otherwise base58 decode.

  let scriptPubKey: Buffer;

  try {
    const { version, data } = bitcoin.address.fromBech32(address);
    // version=0 => P2WPKH, version=1 => P2TR, or nested if we do p2sh inside?
    if (version === 0 && data.length === 20) {
      // P2WPKH => OP_0, 0x14 <pubKeyHash>
      scriptPubKey = bitcoin.script.compile([0x00, data]);
    } else if (version === 0 && data.length === 32) {
      // could be P2WSH
      scriptPubKey = bitcoin.script.compile([0x00, data]);
    } else if (version === 1 && data.length === 32) {
      // P2TR => OP_1, <32-byte x-only pubkey>
      scriptPubKey = bitcoin.script.compile([0x51, data]); // OP_1 = 0x51
    } else {
      // fallback
      scriptPubKey = bitcoin.script.compile([version, data]);
    }
  } catch (e) {
    // base58 decode
    const decoded = bitcoin.address.fromBase58Check(address);
    // If decoded.version === 0 => P2PKH mainnet, 111 => P2PKH testnet
    // If decoded.version === 5 => P2SH mainnet, 196 => P2SH testnet

    // P2PKH => scriptPubKey = OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
    // P2SH => scriptPubKey = OP_HASH160 <scriptHash> OP_EQUAL
    if (decoded.version === 0 || decoded.version === 111) {
      // P2PKH
      scriptPubKey = bitcoin.script.compile([
        0x76, // OP_DUP
        0xa9, // OP_HASH160
        decoded.hash,
        0x88, // OP_EQUALVERIFY
        0xac, // OP_CHECKSIG
      ]);
    } else {
      // P2SH
      scriptPubKey = bitcoin.script.compile([
        0xa9, // OP_HASH160
        decoded.hash,
        0x87, // OP_EQUAL
      ]);
    }
  }

  const hash = createHash("sha256").update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString("hex");
}
