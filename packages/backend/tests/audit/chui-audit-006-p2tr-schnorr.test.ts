/**
 * CHUI-AUDIT-006 — P2TR signing path lacks `signSchnorr`.
 *
 * Background: the wallet uses two signer factories. `toHdSigner` exposes
 * ECDSA `sign` for P2PKH / P2WPKH / P2SH-P2WPKH. `toTaprootSigner` exposes
 * the BIP-86 tweaked pubkey + `signSchnorr` for P2TR key-path. The wallet
 * picks the right factory per input (wallet.ts switches on isTaproot).
 *
 * The audit-006 bug was: P2TR PSBTs went through `toHdSigner`, which has
 * no `signSchnorr`. The fix landed in wallet.ts: P2TR inputs now use
 * `toTaprootSigner`. This test pins that contract by signing a P2TR input
 * with the production taproot signer and validating the witness.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import { toTaprootSigner } from '../../src/utils/crypto';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

describe('CHUI-AUDIT-006 — P2TR signing produces a valid Schnorr witness', () => {
  it('signs a P2TR input with a Schnorr signature that validates', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed);

    // BIP-86 path m/86'/0'/0'/0/0
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const xOnly = Buffer.from(child.publicKey).subarray(1, 33);

    const { output: scriptPubKey } = bitcoin.payments.p2tr({
      internalPubkey: xOnly,
      network: bitcoin.networks.bitcoin,
    });
    expect(scriptPubKey).toBeDefined();

    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    psbt.addInput({
      hash: '0'.repeat(64),
      index: 0,
      witnessUtxo: { script: scriptPubKey!, value: 100_000 },
      tapInternalKey: xOnly,
    });
    psbt.addOutput({ script: scriptPubKey!, value: 99_500 });

    const signer = toTaprootSigner(child);

    expect(typeof signer.signSchnorr).toBe('function');

    psbt.signInput(0, signer);
    expect(psbt.validateSignaturesOfInput(0, () => true)).toBe(true);
  });
});
