import { convertToSlip0132 } from '../../src/utils/xpubConverter';
import { Network } from '../../src/types/electrum';
import { ScriptType } from '../../src/types/wallet';
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import BIP32Factory from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import bs58check from 'bs58check';

const bip32 = BIP32Factory(secp256k1);

function deriveXpub(seedHex: string, network: Network): string {
  const seed = Buffer.from(seedHex, 'hex');
  const net = network === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const node = bip32.fromSeed(seed, net);
  return node.neutered().toBase58();
}

function readVersion(extKey: string): number {
  const bytes = bs58check.decode(extKey);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
}

function writeVersion(extKey: string, version: number): string {
  const bytes = bs58check.decode(extKey);
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  new DataView(out.buffer).setUint32(0, version, false);
  return bs58check.encode(out);
}

const VERSIONS = {
  xpub: 0x0488b21e,
  ypub: 0x049d7cb2,
  zpub: 0x04b24746,
  tpub: 0x043587cf,
  upub: 0x044a5262,
  vpub: 0x045f1cf6,
};

describe('convertToSlip0132', () => {
  const mainnetXpub = deriveXpub('00'.repeat(32), Network.Mainnet);
  const testnetXpub = deriveXpub('11'.repeat(32), Network.Testnet);

  describe('prefix outputs', () => {
    it('produces zpub for P2WPKH on mainnet', () => {
      expect(convertToSlip0132(mainnetXpub, ScriptType.P2WPKH, Network.Mainnet)).toMatch(/^zpub/);
    });

    it('produces ypub for P2SH_P2WPKH on mainnet', () => {
      expect(convertToSlip0132(mainnetXpub, ScriptType.P2SH_P2WPKH, Network.Mainnet)).toMatch(/^ypub/);
    });

    it('returns the original xpub unchanged for P2PKH on mainnet', () => {
      expect(convertToSlip0132(mainnetXpub, ScriptType.P2PKH, Network.Mainnet)).toBe(mainnetXpub);
    });

    it('produces vpub for P2WPKH on testnet', () => {
      expect(convertToSlip0132(testnetXpub, ScriptType.P2WPKH, Network.Testnet)).toMatch(/^vpub/);
    });

    it('produces upub for P2SH_P2WPKH on testnet', () => {
      expect(convertToSlip0132(testnetXpub, ScriptType.P2SH_P2WPKH, Network.Testnet)).toMatch(/^upub/);
    });

    it('returns the original tpub unchanged for P2PKH on testnet', () => {
      expect(convertToSlip0132(testnetXpub, ScriptType.P2PKH, Network.Testnet)).toBe(testnetXpub);
    });
  });

  describe('round-trip: SLIP-0132 → xpub recovers the original key material', () => {
    const cases: Array<{ network: Network; scriptType: ScriptType; standardVersion: number }> = [
      { network: Network.Mainnet, scriptType: ScriptType.P2WPKH, standardVersion: VERSIONS.xpub },
      { network: Network.Mainnet, scriptType: ScriptType.P2SH_P2WPKH, standardVersion: VERSIONS.xpub },
      { network: Network.Mainnet, scriptType: ScriptType.P2PKH, standardVersion: VERSIONS.xpub },
      { network: Network.Testnet, scriptType: ScriptType.P2WPKH, standardVersion: VERSIONS.tpub },
      { network: Network.Testnet, scriptType: ScriptType.P2SH_P2WPKH, standardVersion: VERSIONS.tpub },
      { network: Network.Testnet, scriptType: ScriptType.P2PKH, standardVersion: VERSIONS.tpub },
    ];

    for (const { network, scriptType, standardVersion } of cases) {
      it(`${scriptType} on ${network} round-trips back to the original standard xpub`, () => {
        const original = network === Network.Mainnet ? mainnetXpub : testnetXpub;
        const slip0132 = convertToSlip0132(original, scriptType, network);
        const recovered = writeVersion(slip0132, standardVersion);
        expect(recovered).toBe(original);
      });
    }
  });

  describe('safe-fail behavior', () => {
    it('throws on P2TR — no SLIP-0132 standard exists', () => {
      expect(() => convertToSlip0132(mainnetXpub, ScriptType.P2TR, Network.Mainnet)).toThrow(/P2TR/);
      expect(() => convertToSlip0132(testnetXpub, ScriptType.P2TR, Network.Testnet)).toThrow(/P2TR/);
    });

    it('throws on a malformed (non-base58) input', () => {
      expect(() => convertToSlip0132('not-an-xpub', ScriptType.P2WPKH, Network.Mainnet)).toThrow();
    });

    it('throws on a base58check string of the wrong length', () => {
      const tooShort = bs58check.encode(new Uint8Array(40));
      expect(() => convertToSlip0132(tooShort, ScriptType.P2WPKH, Network.Mainnet)).toThrow(/length/);
    });

    it('throws when the xpub version does not match the requested network', () => {
      expect(() => convertToSlip0132(mainnetXpub, ScriptType.P2WPKH, Network.Testnet)).toThrow(/version/);
      expect(() => convertToSlip0132(testnetXpub, ScriptType.P2WPKH, Network.Mainnet)).toThrow(/version/);
    });

    it('refuses an already-converted zpub (does not double-convert)', () => {
      const zpub = convertToSlip0132(mainnetXpub, ScriptType.P2WPKH, Network.Mainnet);
      expect(() => convertToSlip0132(zpub, ScriptType.P2WPKH, Network.Mainnet)).toThrow(/version/);
    });
  });

  describe('byte-level invariants', () => {
    it('only the first 4 bytes change; remaining 74 bytes are identical', () => {
      const out = convertToSlip0132(mainnetXpub, ScriptType.P2WPKH, Network.Mainnet);
      const orig = bs58check.decode(mainnetXpub);
      const next = bs58check.decode(out);
      expect(next.length).toBe(78);
      expect(next.subarray(4)).toEqual(orig.subarray(4));
      expect(readVersion(out)).toBe(VERSIONS.zpub);
    });
  });
});
