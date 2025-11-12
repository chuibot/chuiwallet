import type { SpendableUtxo } from '../modules/utxoSelection';
import type { ElectrumTransaction } from '../types/electrum';
import { type Account, ScriptType } from '../types/wallet';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import { Network } from '../types/electrum';
import { ChangeType } from '../types/cache';
import { asBuffer, toBitcoinNetwork } from './crypto';
import BIP32Factory from 'bip32';

const bip32 = BIP32Factory(secp256k1);

type BuildParams = {
  inputs: SpendableUtxo[];
  outputs: Array<{ address: string; value: number }>;
  account: Account;
  masterFingerprint: Buffer;
  getPrevTxHex?: (txid: string) => Promise<string | ElectrumTransaction>; // required for legacy P2PKH
};

const purposeFrom = (t: ScriptType) =>
  t === ScriptType.P2TR ? 86 : t === ScriptType.P2WPKH ? 84 : t === ScriptType.P2SH_P2WPKH ? 49 : 44;

export async function buildSpendPsbt({
  inputs,
  outputs,
  account,
  masterFingerprint,
  getPrevTxHex,
}: BuildParams): Promise<bitcoin.Psbt> {
  const network = toBitcoinNetwork(account.network);
  const psbt = new bitcoin.Psbt({ network });
  const purpose = purposeFrom(account.scriptType);
  const coin = account.network === Network.Mainnet ? 0 : 1;
  const accountNode = bip32.fromBase58(account.xpub, network);

  for (const input of inputs) {
    const chainNum: 0 | 1 = input.chain === ChangeType.Internal ? 1 : 0;
    const childNode = accountNode.derive(chainNum).derive(input.index);
    const pubkey = asBuffer(childNode.publicKey);
    const scriptPubKey = bitcoin.address.toOutputScript(input.address, network);
    const path = `m/${purpose}'/${coin}'/${account.index}'/${chainNum}/${input.index}`;
    const base = { hash: input.txid, index: input.vout };

    switch (input.scriptType) {
      case ScriptType.P2WPKH: {
        psbt.addInput({
          ...base,
          witnessUtxo: { script: scriptPubKey, value: input.value },
          bip32Derivation: [{ masterFingerprint, pubkey, path }],
        });
        break;
      }

      case ScriptType.P2SH_P2WPKH: {
        const redeem = bitcoin.payments.p2wpkh({ pubkey, network }).output!;
        psbt.addInput({
          ...base,
          witnessUtxo: { script: scriptPubKey, value: input.value },
          redeemScript: redeem,
          bip32Derivation: [{ masterFingerprint, pubkey, path }],
        });
        break;
      }

      case ScriptType.P2TR: {
        const xOnly = pubkey.length === 33 ? pubkey.slice(1) : pubkey;
        psbt.addInput({
          ...base,
          witnessUtxo: { script: scriptPubKey, value: input.value },
          tapInternalKey: xOnly,
          tapBip32Derivation: [{ masterFingerprint, pubkey: xOnly, path, leafHashes: [] }],
        });
        break;
      }

      case ScriptType.P2PKH: {
        if (!getPrevTxHex) throw new Error('getPrevTxHex required for P2PKH inputs');
        const prevHex = (await getPrevTxHex(input.txid)) as string;
        psbt.addInput({
          ...base,
          nonWitnessUtxo: Buffer.from(prevHex, 'hex'),
          bip32Derivation: [{ masterFingerprint, pubkey, path }],
        });
        break;
      }

      default:
        throw new Error(`Unsupported script type: ${input.scriptType}`);
    }
  }

  for (const o of outputs) psbt.addOutput({ address: o.address, value: o.value });
  return psbt;
}
