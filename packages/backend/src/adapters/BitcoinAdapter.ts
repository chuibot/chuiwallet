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
  type ChainTransactionHistoryOptions,
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
    const confirmedBtc = balance.confirmed / 1e8;
    return {
      confirmed: balance.confirmed,
      unconfirmed: balance.unconfirmed,
      confirmedFiat: balance.confirmedUsd,
      unconfirmedFiat: balance.unconfirmedUsd,
      nativeFiatRate: confirmedBtc > 0 ? balance.confirmedUsd / confirmedBtc : undefined,
    };
  }

  // ── Transactions ──────────────────────────────────────────────────

  async getTransactionHistory(_options?: ChainTransactionHistoryOptions): Promise<ChainTransaction[]> {
    void _options;
    const history = await this.txHistoryService.get();
    return history.map(tx => ({
      hash: tx.transactionHash,
      from: tx.sender,
      to: tx.receiver,
      amount: Math.round(tx.amountBtc * 1e8), // BTC → sats (Math.round guards against float imprecision)
      fee: Math.round(tx.feeBtc * 1e8), // BTC → sats
      timestamp: tx.timestamp,
      confirmations: tx.confirmations,
      status: tx.status === 'CONFIRMED' ? ('confirmed' as const) : ('pending' as const),
      chain: ChainType.Bitcoin,
    }));
  }

  async sendPayment(to: string, amount: string, options?: ChainSendOptions): Promise<string> {
    const feeRate = options?.feeRate ?? 1;
    return this.walletManager.sendPayment(to, this.parseBtcAmountToSats(amount), feeRate);
  }

  async estimateFee(to: string, _amount?: string, _options?: ChainSendOptions): Promise<ChainFeeEstimate[]> {
    void _amount;
    void _options;
    const estimates = await this.walletManager.getFeeEstimates(to);
    if (!estimates) return [];

    return estimates.map(est => ({
      name: est.speed[0].toUpperCase() + est.speed.slice(1),
      speed: est.speed,
      fee: est.btcAmount,
      estimatedTime: `${est.speed}`,
      fiatAmount: est.usdAmount,
      rateValue: est.sats,
      rateUnit: 'sat/vB',
      sendOptions: {
        feeRate: est.sats,
      },
    }));
  }

  private parseBtcAmountToSats(amount: string): number {
    const normalized = this.normalizeBtcAmount(amount);

    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new Error('Invalid BTC amount');
    }

    const [wholePart, fractionalPart = ''] = normalized.split('.');
    if (fractionalPart.length > 8) {
      throw new Error('BTC amount supports up to 8 decimal places');
    }

    const wholeSats = BigInt(wholePart) * BigInt(100000000);
    const fractionalSats = BigInt((fractionalPart + '00000000').slice(0, 8));
    const sats = wholeSats + fractionalSats;

    if (sats <= BigInt(0)) {
      throw new Error('Amount must be greater than 0');
    }

    if (sats > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('BTC amount is too large');
    }

    return Number(sats);
  }

  private normalizeBtcAmount(amount: string): string {
    const trimmedAmount = amount.trim();
    if (trimmedAmount.startsWith('.')) {
      return `0${trimmedAmount}`;
    }

    if (trimmedAmount.endsWith('.')) {
      return trimmedAmount.slice(0, -1);
    }

    return trimmedAmount;
  }
}
