import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import BIP32Factory from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import {
  addressToScriptHash,
  addressToScriptPubKey,
  asBuffer,
  fingerprintBuffer,
  fingerprintNumber,
  purposeFromScriptType,
  scriptTypeFromAddress,
  toBitcoinNetwork,
  toHdSigner,
  toTaprootSigner,
} from '../../src/utils/crypto';
import { Network } from '../../src/types/electrum';
import { ScriptType } from '../../src/types/wallet';

const bip32 = BIP32Factory(secp256k1);

describe('toBitcoinNetwork', () => {
  it('returns mainnet network for Network.Mainnet', () => {
    expect(toBitcoinNetwork(Network.Mainnet)).toBe(bitcoin.networks.bitcoin);
  });

  it('returns testnet network for Network.Testnet', () => {
    expect(toBitcoinNetwork(Network.Testnet)).toBe(bitcoin.networks.testnet);
  });
});

describe('purposeFromScriptType', () => {
  it.each([
    [ScriptType.P2PKH, 44],
    [ScriptType.P2SH_P2WPKH, 49],
    [ScriptType.P2WPKH, 84],
    [ScriptType.P2TR, 86],
  ])('maps %s to %i', (st, expected) => {
    expect(purposeFromScriptType(st)).toBe(expected);
  });

  it('throws on unknown script type', () => {
    expect(() => purposeFromScriptType('garbage' as ScriptType)).toThrow('Unknown script type');
  });
});

describe('scriptTypeFromAddress', () => {
  it.each([
    ['bc1pmzfrwwndsqmk5yh69yjr5lfgfg4ev8c0tsc06e', ScriptType.P2TR],
    ['tb1ph8u2hjzj4q9qkx2mh3v75stpx7ap4t8vy36cln5xs66e7gevc7lq2tmzpv', ScriptType.P2TR],
    ['bcrt1pq8j2lk9c5y3mz8st5pq3vxlq2pq8j2lk9c5y3mz8st5pq3vxlq2yqxxxxx', ScriptType.P2TR],
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', ScriptType.P2WPKH],
    ['tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', ScriptType.P2WPKH],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', ScriptType.P2SH_P2WPKH],
    ['2N2JD6wb56AfK4tfmM6PwdVmoYk2dCKf4Br', ScriptType.P2SH_P2WPKH],
    ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', ScriptType.P2PKH],
    ['mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef', ScriptType.P2PKH],
    ['n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi', ScriptType.P2PKH],
  ])('returns %s for "%s"', (addr, expected) => {
    expect(scriptTypeFromAddress(addr)).toBe(expected);
  });

  it('falls back to P2PKH for unknown prefixes', () => {
    expect(scriptTypeFromAddress('zzzunknown')).toBe(ScriptType.P2PKH);
  });

  it('is case-insensitive', () => {
    expect(scriptTypeFromAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4')).toBe(ScriptType.P2WPKH);
  });
});

describe('addressToScriptHash + addressToScriptPubKey', () => {
  const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const network = bitcoin.networks.bitcoin;

  it('addressToScriptPubKey produces a hex string', () => {
    const hex = addressToScriptPubKey(addr, network);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('addressToScriptHash returns 32-byte hex (64 chars)', () => {
    const sh = addressToScriptHash(addr, network);
    expect(sh).toHaveLength(64);
    expect(sh).toMatch(/^[0-9a-f]+$/);
  });

  it('addressToScriptHash is the reversed sha256 of the script', () => {
    const script = bitcoin.address.toOutputScript(addr, network);
    const expected = Buffer.from(bitcoin.crypto.sha256(script)).reverse().toString('hex');
    expect(addressToScriptHash(addr, network)).toBe(expected);
  });

  it('different addresses produce different script hashes', () => {
    const a = addressToScriptHash('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', network);
    const b = addressToScriptHash('bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', network);
    expect(a).not.toEqual(b);
  });
});

describe('fingerprint helpers', () => {
  const seed = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
  const node = bip32.fromSeed(seed, bitcoin.networks.bitcoin);

  it('fingerprintNumber returns an unsigned 32-bit integer', () => {
    const n = fingerprintNumber(node);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(0xffffffff);
  });

  it('fingerprintBuffer is a 4-byte Buffer encoding the same number big-endian', () => {
    const n = fingerprintNumber(node);
    const buf = fingerprintBuffer(node);
    expect(buf.length).toBe(4);
    expect(buf.readUInt32BE(0)).toBe(n);
  });

  it('falls back to hash160(pubkey) when fingerprint is missing on the node', () => {
    const fakeNode = {
      publicKey: node.publicKey,
    } as unknown as Parameters<typeof fingerprintNumber>[0];
    const expected = bitcoin.crypto.hash160(Buffer.from(node.publicKey)).readUInt32BE(0) >>> 0;
    expect(fingerprintNumber(fakeNode)).toBe(expected);
  });
});

describe('asBuffer + toHdSigner', () => {
  it('asBuffer preserves a Buffer instance', () => {
    const b = Buffer.from([1, 2, 3]);
    expect(asBuffer(b)).toBe(b);
  });

  it('asBuffer wraps a Uint8Array into a Buffer', () => {
    const u = new Uint8Array([1, 2, 3]);
    const out = asBuffer(u);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(3);
  });

  it('toHdSigner exposes publicKey + sign that returns a Buffer', () => {
    const seed = Buffer.from('11'.repeat(32), 'hex');
    const node = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const signer = toHdSigner(node);
    expect(Buffer.isBuffer(signer.publicKey)).toBe(true);
    const sig = signer.sign(Buffer.alloc(32, 7));
    expect(Buffer.isBuffer(sig)).toBe(true);
    expect(sig.length).toBeGreaterThan(0);
  });

  it('toHdSigner.sign throws when the underlying node has no sign function', () => {
    const noSigner = { publicKey: new Uint8Array(33) } as unknown as ReturnType<
      ReturnType<typeof BIP32Factory>['fromSeed']
    >;
    const signer = toHdSigner(noSigner);
    expect(() => signer.sign(Buffer.alloc(32))).toThrow('Node cannot sign');
  });
});

describe('toTaprootSigner', () => {
  const seed = Buffer.from('11'.repeat(32), 'hex');
  const node = bip32.fromSeed(seed, bitcoin.networks.bitcoin);

  it('returns a signer with x-only tweaked publicKey matching BIP-86 derivation', () => {
    const signer = toTaprootSigner(node);
    expect(signer.publicKey.length).toBe(32);

    const internalXOnly = Buffer.from(node.publicKey).subarray(1);
    const tweak = bitcoin.crypto.taggedHash('TapTweak', internalXOnly);
    const expected = secp256k1.xOnlyPointAddTweak(internalXOnly, tweak);
    expect(expected).not.toBeNull();
    expect(Buffer.from(expected!.xOnlyPubkey)).toEqual(signer.publicKey);
  });

  it('signSchnorr produces a 64-byte signature that verifies under the tweaked output key', () => {
    const signer = toTaprootSigner(node);
    expect(signer.signSchnorr).toBeDefined();
    const msg = Buffer.alloc(32, 0xab);
    const sig = signer.signSchnorr!(msg);
    expect(Buffer.isBuffer(sig)).toBe(true);
    expect(sig.length).toBe(64);
    expect(secp256k1.verifySchnorr(msg, signer.publicKey, sig)).toBe(true);
  });

  it('throws when the node has no private key', () => {
    const neutered = node.neutered();
    expect(() => toTaprootSigner(neutered)).toThrow('Node missing private key');
  });
});
