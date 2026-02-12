import type { Network } from '../types/electrum';
import type { Balance } from '../types/wallet';
import type { WalletManager } from '../walletManager';
import type { ElectrumService } from '../modules/electrumService';
import type { ScanManager } from '../scanManager';
import type { TxHistoryService } from '../modules/txHistoryService';
import { ChangeType } from '../types/cache';
import {
  ChainType,
  type IChainAdapter,
  type ChainBalance,
  type ChainTransaction,
  type ChainFeeEstimate,
  type ChainSendOptions,
} from './IChainAdapter';

/**
 * Bitcoin adapter — wraps the existing WalletManager, ScanManager,
 * ElectrumService, and TxHistoryService behind the IChainAdapter interface.
 *
 * This is intentionally a thin delegation layer. All Bitcoin-specific logic
 * remains in the existing managers; this adapter only translates calls into
 * the common interface so the messaging layer and UI can be chain-agnostic.
 */
export class BitcoinAdapter implements IChainAdapter {
  readonly chainType = ChainType.Bitcoin;
  readonly symbol = 'BTC';
  readonly decimals = 8;
  readonly displayName = 'Bitcoin';

  constructor(
    private walletManager: WalletManager,
    private electrumService: ElectrumService,
    private scanManager: ScanManager,
    private txHistoryService: TxHistoryService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────

  async init(network: Network): Promise<void> {
    await this.electrumService.init(network);
  }

  async connect(): Promise<void> {
    await this.electrumService.connect();
  }

  async disconnect(): Promise<void> {
    await this.electrumService.disconnect();
  }

  // ── Address & Account ─────────────────────────────────────────────

  deriveAddress(_accountIndex: number, addressIndex: number): string {
    const address = this.walletManager.deriveAddress(0, addressIndex);
    if (!address) {
      throw new Error(`Failed to derive BTC address at index ${addressIndex}`);
    }
    return address;
  }

  getReceivingAddress(): string {
    const address = this.walletManager.getAddress(ChangeType.External);
    if (!address) {
      throw new Error('No receiving address available');
    }
    return address;
  }

  // ── Balance ───────────────────────────────────────────────────────

  async getBalance(): Promise<ChainBalance> {
    const balance: Balance = await this.walletManager.getBalance();
    return {
      confirmed: balance.confirmed,
      unconfirmed: balance.unconfirmed,
      confirmedFiat: balance.confirmedUsd,
      unconfirmedFiat: balance.unconfirmedUsd,
    };
  }

  // ── Transactions ──────────────────────────────────────────────────

  async getTransactionHistory(): Promise<ChainTransaction[]> {
    const history = await this.txHistoryService.get();
    return history.map(tx => ({
      hash: tx.transactionHash,
      from: tx.sender,
      to: tx.receiver,
      amount: Math.round(tx.amountBtc * 1e8), // BTC → satoshis
      fee: Math.round(tx.feeBtc * 1e8),
      timestamp: tx.timestamp,
      confirmations: tx.confirmations,
      status: tx.status === 'CONFIRMED' ? ('confirmed' as const) : ('pending' as const),
      chain: ChainType.Bitcoin,
    }));
  }

  async sendPayment(to: string, amount: number, options?: ChainSendOptions): Promise<string> {
    const feeRate = options?.feeRate ?? 1;
    return this.walletManager.sendPayment(to, amount, feeRate);
  }

  async estimateFee(to: string, _amount: number): Promise<ChainFeeEstimate[]> {
    const estimates = await this.walletManager.getFeeEstimates(to);
    if (!estimates) return [];

    return estimates.map(est => ({
      speed: est.speed,
      fee: est.sats,
      estimatedTime: `${est.speed}`,
      fiatAmount: est.usdAmount,
    }));
  }
}
