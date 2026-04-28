import { convertToSlip0132 } from '../../src/utils/xpubConverter';
import { Network } from '../../src/types/electrum';
import { ScriptType } from '../../src/types/wallet';
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import BIP32Factory from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';

const bip32 = BIP32Factory(secp256k1);

function deriveXpub(seedHex: string, network: Network): string {
  const seed = Buffer.from(seedHex, 'hex');
  const net = network === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const node = bip32.fromSeed(seed, net);
  return node.neutered().toBase58();
}

describe('convertToSlip0132', () => {
  const mainnetXpub = deriveXpub('00'.repeat(32), Network.Mainnet);
  const testnetXpub = deriveXpub('11'.repeat(32), Network.Testnet);

  it('produces zpub for P2WPKH on mainnet', () => {
    const out = convertToSlip0132(mainnetXpub, ScriptType.P2WPKH, Network.Mainnet);
    expect(out.startsWith('zpub')).toBe(true);
  });

  it('produces ypub for P2SH_P2WPKH on mainnet', () => {
    const out = convertToSlip0132(mainnetXpub, ScriptType.P2SH_P2WPKH, Network.Mainnet);
    expect(out.startsWith('ypub')).toBe(true);
  });

  it('keeps xpub for P2PKH/P2TR on mainnet (no SLIP-0132 prefix change)', () => {
    expect(convertToSlip0132(mainnetXpub, ScriptType.P2PKH, Network.Mainnet).startsWith('xpub')).toBe(true);
    expect(convertToSlip0132(mainnetXpub, ScriptType.P2TR, Network.Mainnet).startsWith('xpub')).toBe(true);
  });

  it('produces vpub for P2WPKH on testnet', () => {
    const out = convertToSlip0132(testnetXpub, ScriptType.P2WPKH, Network.Testnet);
    expect(out.startsWith('vpub')).toBe(true);
  });

  it('produces upub for P2SH_P2WPKH on testnet', () => {
    const out = convertToSlip0132(testnetXpub, ScriptType.P2SH_P2WPKH, Network.Testnet);
    expect(out.startsWith('upub')).toBe(true);
  });

  it('returns the original string and logs on bad input', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = convertToSlip0132('not-an-xpub', ScriptType.P2WPKH, Network.Mainnet);
    expect(result).toBe('not-an-xpub');
    errSpy.mockRestore();
  });
});
