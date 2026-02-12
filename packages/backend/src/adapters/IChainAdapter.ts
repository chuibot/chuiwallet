import type { Network } from '../types/electrum';

/**
 * Supported blockchain types
 */
export enum ChainType {
  Bitcoin = 'bitcoin',
  Ethereum = 'ethereum',
}

/**
 * Balance for a specific chain/token
 */
export interface TokenBalance {
  symbol: string;
  balance: number;
  decimals: number;
}

export interface ChainBalance {
  /** Amount in display units (satoshis for BTC, ETH for Ethereum) */
  confirmed: number;
  unconfirmed: number;
  /** Fiat-converted values */
  confirmedFiat: number;
  unconfirmedFiat: number;
  /** For chains with tokens (e.g. ETH has USDT) — balances in display units */
  tokens?: Record<string, TokenBalance>;
}

/**
 * Normalized transaction record across chains
 */
export interface ChainTransaction {
  hash: string;
  from: string;
  to: string;
  /** Amount in native smallest unit */
  amount: number;
  /** Fee in native smallest unit */
  fee: number;
  /** Unix timestamp (seconds) */
  timestamp: number;
  confirmations: number;
  status: 'confirmed' | 'pending' | 'failed';
  chain: ChainType;
}

/**
 * Fee estimate for a transaction
 */
export interface ChainFeeEstimate {
  /** Display name (e.g. "Standard", "Fast") - maps to 'speed' or 'name' */
  name?: string;
  speed?: string;
  /** Fee in native smallest unit */
  fee: number;
  /** Estimated confirmation time description */
  estimatedTime?: string;
  timeEstimate?: number; // numeric estimate in minutes/blocks
  /** Fee in fiat */
  fiatAmount?: number;
  minerTip?: number;
}

/**
 * Options for sending a transaction
 */
export interface ChainSendOptions {
  fee?: number;
  /** For ERC-20: gas limit */
  gasLimit?: number;
  /** For BTC: fee rate in sat/vB */
  feeRate?: number;
  /** For ERC-20 transfers */
  tokenAddress?: string;
}

/**
 * Common interface for all blockchain adapters.
 *
 * Each supported chain implements this interface, allowing the rest of the
 * codebase to interact with any chain through a unified API.
 */
export interface IChainAdapter {
  readonly chainType: ChainType;
  /** Ticker symbol, e.g. 'BTC', 'ETH', 'USDT' */
  readonly symbol: string;
  /** Decimal places for display (8 for BTC, 18 for ETH, 6 for USDT) */
  readonly decimals: number;
  /** Human-readable chain name */
  readonly displayName: string;

  // ── Lifecycle ─────────────────────────────────────────────────────

  /** Initialize the adapter for the given network */
  init(network: Network): Promise<void>;

  /** Establish connection to the chain's backend/RPC */
  connect(): Promise<void>;

  /** Tear down connections */
  disconnect(): Promise<void>;

  // ── Address & Account ─────────────────────────────────────────────

  /**
   * Derive an address for the given account and address index.
   *
   * For BTC: uses scriptType-specific derivation.
   * For ETH: uses BIP-44 m/44'/60'/0'/0/{addressIndex}.
   */
  deriveAddress(accountIndex: number, addressIndex: number): string;

  /** Get the current receiving address */
  getReceivingAddress(): string;

  // ── Balance ───────────────────────────────────────────────────────

  /** Fetch the current balance from the network */
  getBalance(): Promise<ChainBalance>;

  // ── Transactions ──────────────────────────────────────────────────

  /** Fetch transaction history */
  getTransactionHistory(): Promise<ChainTransaction[]>;

  /** Send a payment, returns the transaction hash */
  sendPayment(to: string, amount: number, options?: ChainSendOptions): Promise<string>;

  /** Estimate fees for a transaction */
  estimateFee(to: string, amount: number, options?: ChainSendOptions): Promise<ChainFeeEstimate[]>;
}
