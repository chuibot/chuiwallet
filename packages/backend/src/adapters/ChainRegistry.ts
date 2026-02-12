import type { Network } from '../types/electrum';
import { ChainType, type IChainAdapter } from './IChainAdapter';

/**
 * Central registry for managing chain adapters.
 *
 * Provides a single point of access for all registered chain adapters,
 * allowing the messaging layer and UI to interact with any chain
 * without knowing the concrete implementation.
 */
export class ChainRegistry {
  private adapters = new Map<ChainType, IChainAdapter>();

  /** Register a chain adapter */
  register(adapter: IChainAdapter): void {
    this.adapters.set(adapter.chainType, adapter);
  }

  /** Get an adapter by chain type */
  get(chain: ChainType): IChainAdapter | undefined {
    return this.adapters.get(chain);
  }

  /** Get all registered adapters */
  getAll(): IChainAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** Check if an adapter is registered */
  has(chain: ChainType): boolean {
    return this.adapters.has(chain);
  }

  /** Initialize all registered adapters for the given network */
  async initAll(network: Network): Promise<void> {
    const tasks = this.getAll().map(adapter => adapter.init(network));
    await Promise.all(tasks);
  }

  /** Connect all registered adapters */
  async connectAll(): Promise<void> {
    const tasks = this.getAll().map(adapter => adapter.connect());
    await Promise.all(tasks);
  }

  /** Disconnect all registered adapters */
  async disconnectAll(): Promise<void> {
    const tasks = this.getAll().map(adapter => adapter.disconnect());
    await Promise.all(tasks);
  }

  /** Fetch balances from all adapters in parallel (partial results if one fails) */
  async getAllBalances(): Promise<Record<string, Awaited<ReturnType<IChainAdapter['getBalance']>>>> {
    const adapters = this.getAll();
    const results = await Promise.allSettled(
      adapters.map(async adapter => ({
        symbol: adapter.symbol,
        balance: await adapter.getBalance(),
      })),
    );

    const balances: Record<string, Awaited<ReturnType<IChainAdapter['getBalance']>>> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        balances[result.value.symbol] = result.value.balance;
      }
      // Rejected adapters are silently skipped — partial balances returned
    }
    return balances;
  }
}

/** Singleton registry instance */
export const chainRegistry = new ChainRegistry();
