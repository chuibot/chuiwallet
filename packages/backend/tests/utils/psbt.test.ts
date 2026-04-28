import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { buildSpendPsbt } from '../../src/utils/psbt';
import { ScriptType, type Account } from '../../src/types/wallet';
import { Network } from '../../src/types/electrum';
import { ChangeType } from '../../src/types/cache';
import type { SpendableUtxo } from '../../src/modules/utxoSelection';
import { fingerprintBuffer } from '../../src/utils/crypto';

bitcoin.initEccLib(secp256k1);

const bip32 = BIP32Factory(secp256k1);

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccountAndDerive(scriptType: ScriptType): {
  account: Account;
  fingerprint: Buffer;
  rootFingerprint: Buffer;
  network: bitcoin.Network;
  deriveAddress: (chain: number, idx: number) => string;
} {
  const seed = bip39.mnemonicToSeedSync(MNEMONIC);
  const network = bitcoin.networks.bitcoin;
  const root = bip32.fromSeed(seed, network);
  const purpose =
    scriptType === ScriptType.P2TR
      ? 86
      : scriptType === ScriptType.P2WPKH
        ? 84
        : scriptType === ScriptType.P2SH_P2WPKH
          ? 49
          : 44;
  const accountNode = root.deriveHardened(purpose).deriveHardened(0).deriveHardened(0);
  const xpub = accountNode.neutered().toBase58();
  const account: Account = {
    name: 'Account #1',
    index: 0,
    network: Network.Mainnet,
    xpub,
    scriptType,
  };

  const deriveAddress = (chain: number, idx: number): string => {
    const node = accountNode.derive(chain).derive(idx);
    const pubkey = Buffer.from(node.publicKey);
    if (scriptType === ScriptType.P2WPKH) {
      return bitcoin.payments.p2wpkh({ pubkey, network }).address!;
    }
    if (scriptType === ScriptType.P2SH_P2WPKH) {
      return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network }).address!;
    }
    if (scriptType === ScriptType.P2TR) {
      return bitcoin.payments.p2tr({ internalPubkey: pubkey.slice(1), network }).address!;
    }
    return bitcoin.payments.p2pkh({ pubkey, network }).address!;
  };

  const rootFp = fingerprintBuffer(root);
  return { account, fingerprint: rootFp, rootFingerprint: rootFp, network, deriveAddress };
}

const mkUtxo = (
  scriptType: ScriptType,
  address: string,
  chain: ChangeType = ChangeType.External,
  index = 0,
): SpendableUtxo => ({
  txid: '0'.repeat(64),
  vout: 0,
  value: 100_000,
  height: 800_000,
  confirmations: 6,
  address,
  index,
  chain,
  scriptType,
});

describe('buildSpendPsbt', () => {
  it('builds a PSBT with witnessUtxo + bip32Derivation for P2WPKH', async () => {
    const { account, rootFingerprint, deriveAddress } = makeAccountAndDerive(ScriptType.P2WPKH);
    const addr = deriveAddress(0, 0);
    const psbt = await buildSpendPsbt({
      inputs: [mkUtxo(ScriptType.P2WPKH, addr)],
      outputs: [{ address: addr, value: 90_000 }],
      account,
      masterFingerprint: rootFingerprint,
    });
    const data = psbt.data.inputs[0];
    expect(data.witnessUtxo).toBeDefined();
    expect(data.bip32Derivation).toBeDefined();
    expect(data.bip32Derivation![0].path).toBe(`m/84'/0'/0'/0/0`);
  });

  it('adds redeemScript for P2SH_P2WPKH', async () => {
    const { account, rootFingerprint, deriveAddress } = makeAccountAndDerive(ScriptType.P2SH_P2WPKH);
    const addr = deriveAddress(0, 0);
    const psbt = await buildSpendPsbt({
      inputs: [mkUtxo(ScriptType.P2SH_P2WPKH, addr)],
      outputs: [{ address: addr, value: 90_000 }],
      account,
      masterFingerprint: rootFingerprint,
    });
    expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    expect(psbt.data.inputs[0].witnessUtxo).toBeDefined();
  });

  it('adds tapInternalKey + tapBip32Derivation for P2TR with x-only pubkey', async () => {
    const { account, rootFingerprint, deriveAddress } = makeAccountAndDerive(ScriptType.P2TR);
    const addr = deriveAddress(0, 0);
    const psbt = await buildSpendPsbt({
      inputs: [mkUtxo(ScriptType.P2TR, addr)],
      outputs: [{ address: addr, value: 90_000 }],
      account,
      masterFingerprint: rootFingerprint,
    });
    const data = psbt.data.inputs[0];
    expect(data.tapInternalKey).toBeDefined();
    expect(data.tapInternalKey!.length).toBe(32);
    expect(data.tapBip32Derivation).toBeDefined();
    expect(data.tapBip32Derivation![0].pubkey.length).toBe(32);
  });

  it('uses internal-chain (1) path for change utxos', async () => {
    const { account, rootFingerprint, deriveAddress } = makeAccountAndDerive(ScriptType.P2WPKH);
    const addr = deriveAddress(1, 7);
    const psbt = await buildSpendPsbt({
      inputs: [mkUtxo(ScriptType.P2WPKH, addr, ChangeType.Internal, 7)],
      outputs: [{ address: addr, value: 90_000 }],
      account,
      masterFingerprint: rootFingerprint,
    });
    expect(psbt.data.inputs[0].bip32Derivation![0].path).toBe(`m/84'/0'/0'/1/7`);
  });

  it('throws when P2PKH inputs are used without getPrevTxHex', async () => {
    const { account, rootFingerprint, deriveAddress } = makeAccountAndDerive(ScriptType.P2PKH);
    const addr = deriveAddress(0, 0);
    await expect(
      buildSpendPsbt({
        inputs: [mkUtxo(ScriptType.P2PKH, addr)],
        outputs: [{ address: addr, value: 90_000 }],
        account,
        masterFingerprint: rootFingerprint,
      }),
    ).rejects.toThrow('getPrevTxHex required');
  });

  it('attaches a non-witness UTXO when getPrevTxHex provides one', async () => {
    const { account, rootFingerprint, deriveAddress, network } = makeAccountAndDerive(ScriptType.P2PKH);
    const addr = deriveAddress(0, 0);
    const prev = new bitcoin.Transaction();
    prev.addInput(Buffer.alloc(32, 0), 0xffffffff);
    prev.addOutput(bitcoin.address.toOutputScript(addr, network), 100_000);
    const prevHex = prev.toHex();
    const utxo = { ...mkUtxo(ScriptType.P2PKH, addr), txid: prev.getId() };
    const psbt = await buildSpendPsbt({
      inputs: [utxo],
      outputs: [{ address: addr, value: 90_000 }],
      account,
      masterFingerprint: rootFingerprint,
      getPrevTxHex: async () => prevHex,
    });
    expect(psbt.data.inputs[0].nonWitnessUtxo).toBeDefined();
    expect(Buffer.isBuffer(psbt.data.inputs[0].nonWitnessUtxo)).toBe(true);
  });

  it('adds outputs in the supplied order', async () => {
    const { account, rootFingerprint, deriveAddress } = makeAccountAndDerive(ScriptType.P2WPKH);
    const addr0 = deriveAddress(0, 0);
    const addr1 = deriveAddress(1, 0);
    const psbt = await buildSpendPsbt({
      inputs: [mkUtxo(ScriptType.P2WPKH, addr0)],
      outputs: [
        { address: addr1, value: 1000 },
        { address: addr0, value: 2000 },
      ],
      account,
      masterFingerprint: rootFingerprint,
    });
    expect(psbt.txOutputs).toHaveLength(2);
    expect(psbt.txOutputs[0].value).toBe(1000);
    expect(psbt.txOutputs[1].value).toBe(2000);
  });
});
