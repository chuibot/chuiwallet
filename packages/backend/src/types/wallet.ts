import type { Network } from './electrum';
import type { ChangeType } from './cache';
import type { ChainType } from '../adapters/IChainAdapter';

export interface WalletMeta {
  vault: string | null;
}

export interface Vault {
  mnemonic: string | null;
  xpriv: string | null;
}

/**
 * Metadata for HD-wallet account.
 *
 * The `chain` and `address` fields are optional for backward compatibility
 * with existing Bitcoin-only accounts created before multi-chain support.
 * When absent, the account is assumed to be Bitcoin.
 */
export interface Account {
  name: string;
  index: number;
  network: Network;
  xpub: string;
  scriptType: ScriptType;
  /** Blockchain this account belongs to. Defaults to Bitcoin if absent. */
  chain?: ChainType;
  /** Derived address (used by address-based chains like Ethereum). */
  address?: string;
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

/**
 * Aggregated balances across all supported chains.
 * Keyed by chain symbol (e.g. 'BTC', 'ETH', 'USDT').
 */
export type MultiChainBalance = Record<string, Balance>;
