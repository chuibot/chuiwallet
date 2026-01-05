import { ScriptType } from '../types/wallet';
import { Network } from '../types/electrum';
import * as bitcoin from 'bitcoinjs-lib';
import BIP32Factory from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';

const bip32 = BIP32Factory(secp256k1);

// SLIP-0132 version bytes (Big Endian)
// https://github.com/satoshilabs/slips/blob/master/slip-0132.md

const VERSION_BYTES = {
  [Network.Mainnet]: {
    [ScriptType.P2PKH]: 0x0488b21e, // xpub
    [ScriptType.P2SH_P2WPKH]: 0x049d7cb2, // ypub
    [ScriptType.P2WPKH]: 0x04b24746, // zpub
    [ScriptType.P2TR]: 0x0488b21e, // xpub (No widespread standard for P2TR xpub yet, defaulting to standard)
  },
  [Network.Testnet]: {
    [ScriptType.P2PKH]: 0x043587cf, // tpub
    [ScriptType.P2SH_P2WPKH]: 0x044a5262, // upub
    [ScriptType.P2WPKH]: 0x045f1cf6, // vpub
    [ScriptType.P2TR]: 0x043587cf, // tpub
  },
};

/**
 * Converts a standard xpub/tpub to SLIP-0132 compliant format based on script type.
 * @param xpub The standard xpub string.
 * @param scriptType The script type of the account.
 * @param network The network (mainnet/testnet).
 * @returns The converted SLIP-0132 xpub string.
 */
export function convertToSlip0132(xpub: string, scriptType: ScriptType, network: Network): string {
  try {
    const bitcoinNetwork = network === Network.Mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

    // Parse the xpub using the standard network
    const node = bip32.fromBase58(xpub, bitcoinNetwork);

    const version = VERSION_BYTES[network][scriptType];
    if (!version) {
      console.warn(`No SLIP-0132 version found for ${scriptType} on ${network}, returning original xpub.`);
      return xpub;
    }

    const customNetwork = {
      ...bitcoinNetwork,
      bip32: {
        ...bitcoinNetwork.bip32,
        public: version,
        private: bitcoinNetwork.bip32.private, // Not used for xpub but required by type
      },
    };

    // Temporarily assign the custom network to the node to encode with the new version
    // Casting to 'any' because strict types might prevent writing to 'network'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node as any).network = customNetwork;

    return node.toBase58();
  } catch (error) {
    console.error('Failed to convert xpub to SLIP-0132:', error);
    return xpub;
  }
}
