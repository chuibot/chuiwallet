import { ScriptType } from '../types/wallet';
import { Network } from '../types/electrum';
import bs58check from 'bs58check';

// SLIP-0132 version bytes (big-endian, 4 bytes).
// https://github.com/satoshilabs/slips/blob/master/slip-0132.md
const SLIP0132_VERSIONS: Record<Network, Partial<Record<ScriptType, number>>> = {
  [Network.Mainnet]: {
    [ScriptType.P2PKH]: 0x0488b21e, // xpub
    [ScriptType.P2SH_P2WPKH]: 0x049d7cb2, // ypub
    [ScriptType.P2WPKH]: 0x04b24746, // zpub
  },
  [Network.Testnet]: {
    [ScriptType.P2PKH]: 0x043587cf, // tpub
    [ScriptType.P2SH_P2WPKH]: 0x044a5262, // upub
    [ScriptType.P2WPKH]: 0x045f1cf6, // vpub
  },
};

const STANDARD_PUBLIC_VERSION: Record<Network, number> = {
  [Network.Mainnet]: 0x0488b21e, // xpub
  [Network.Testnet]: 0x043587cf, // tpub
};

const EXT_KEY_LEN = 78;

export function convertToSlip0132(xpub: string, scriptType: ScriptType, network: Network): string {
  if (scriptType === ScriptType.P2TR) {
    throw new Error('P2TR xpub export is not standardized; use a descriptor like tr([fp/86h/0h/0h]xpub...) instead');
  }

  const targetVersion = SLIP0132_VERSIONS[network][scriptType];
  if (targetVersion === undefined) {
    throw new Error(`Unsupported scriptType ${scriptType} for SLIP-0132 conversion on ${network}`);
  }

  const decoded = bs58check.decode(xpub);
  if (decoded.length !== EXT_KEY_LEN) {
    throw new Error(`Invalid extended key length: ${decoded.length}`);
  }

  const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const actualVersion = view.getUint32(0, false);
  if (actualVersion !== STANDARD_PUBLIC_VERSION[network]) {
    throw new Error(`Unexpected xpub version 0x${actualVersion.toString(16)} for ${network}`);
  }

  if (targetVersion === actualVersion) {
    return xpub;
  }

  const out = new Uint8Array(EXT_KEY_LEN);
  out.set(decoded);
  new DataView(out.buffer).setUint32(0, targetVersion, false);
  return bs58check.encode(out);
}
