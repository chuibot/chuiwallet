/**
 * CHUI-AUDIT-006 — P2TR signing path lacks `signSchnorr`.
 *
 * The bug: toHdSigner() in packages/backend/src/utils/crypto.ts returns a
 * bitcoinjs-lib Signer that has only `sign` (ECDSA), no `signSchnorr`. When
 * the wallet builds a P2TR PSBT and calls psbt.signInput, bitcoinjs-lib
 * either throws or produces a non-Schnorr witness, both of which mean the
 * tx will not confirm.
 *
 * The fix: add a `signSchnorr` implementation that derives the BIP-86 tap
 * tweak and uses @bitcoinerlab/secp256k1's signSchnorr.
 *
 * This test currently FAILS on main (8f53021). It passes once the fix lands.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import { toHdSigner } from '../../src/utils/crypto';

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

    const signer = toHdSigner(child);

    // After fix: signer has signSchnorr and the call succeeds.
    expect(typeof signer.signSchnorr).toBe('function');

    psbt.signInput(0, signer);
    expect(psbt.validateSignaturesOfInput(0, () => true)).toBe(true);
  });
});
