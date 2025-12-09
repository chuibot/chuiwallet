import type { Network } from './electrum';
import type { ChangeType } from './cache';

export interface WalletMeta {
  vault: string | null;
}

export interface Vault {
  mnemonic: string | null;
  xpriv: string | null;
}

/**
 * Metadata for HD-wallet account
 */
export interface Account {
  name: string;
  index: number;
  network: Network;
  xpub: string;
  scriptType: ScriptType;
}

/**
 * BIP-43 “purpose” / on-chain script type for this account
 */
export enum ScriptType {
  P2PKH = 'p2pkh' /** Legacy P2PKH (BIP-44) */,
  P2SH_P2WPKH = 'p2sh' /** Nested SegWit (P2SH-wrapped P2WPKH, BIP-49) */,
  P2WPKH = 'p2wpkh' /** Native SegWit Bech32 (P2WPKH, BIP-84) */,
  P2TR = 'p2tr' /** Taproot (P2TR, BIP-86) */,
}

export interface Balance {
  confirmed: number;
  unconfirmed: number;
  confirmedUsd: number;
  unconfirmedUsd: number;
}
