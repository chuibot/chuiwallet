import { ChainRegistry } from '../../src/adapters/ChainRegistry';
import {
  ChainType,
  type ChainBalance,
  type ChainFeeEstimate,
  type ChainSendOptions,
  type ChainTransaction,
  type ChainTransactionHistoryOptions,
  type IChainAdapter,
} from '../../src/adapters/IChainAdapter';
import { Network } from '../../src/types/electrum';

class StubAdapter implements IChainAdapter {
  readonly chainType: ChainType;
  readonly symbol: string;
  readonly decimals: number;
  readonly displayName: string;
  initCalls = 0;
  connectCalls = 0;
  disconnectCalls = 0;
  balanceImpl: () => Promise<ChainBalance>;
  cachedBalanceImpl?: () => Promise<ChainBalance | null>;

  constructor(chainType: ChainType, opts?: { symbol?: string; balanceImpl?: () => Promise<ChainBalance> }) {
    this.chainType = chainType;
    this.symbol = opts?.symbol ?? chainType.toUpperCase();
    this.decimals = 8;
    this.displayName = chainType;
    this.balanceImpl =
      opts?.balanceImpl ?? (async () => ({ confirmed: 1, unconfirmed: 0, confirmedFiat: 0, unconfirmedFiat: 0 }));
  }

  async init(_n: Network) {
    void _n;
    this.initCalls++;
  }
  async connect() {
    this.connectCalls++;
  }
  async disconnect() {
    this.disconnectCalls++;
  }
  deriveAddress() {
    return 'addr';
  }
  getReceivingAddress() {
    return 'addr';
  }
  async getBalance() {
    return this.balanceImpl();
  }
  async getCachedBalance() {
    return this.cachedBalanceImpl ? this.cachedBalanceImpl() : null;
  }
  async getTransactionHistory(_o?: ChainTransactionHistoryOptions): Promise<ChainTransaction[]> {
    void _o;
    return [];
  }
  async sendPayment(_to: string, _amount: string, _o?: ChainSendOptions): Promise<string> {
    void _to;
    void _amount;
    void _o;
    return 'txhash';
  }
  async estimateFee(_to: string, _amount?: string, _o?: ChainSendOptions): Promise<ChainFeeEstimate[]> {
    void _to;
    void _amount;
    void _o;
    return [];
  }
}

describe('ChainRegistry', () => {
  it('register / get / has / getAll', () => {
    const reg = new ChainRegistry();
    const btc = new StubAdapter(ChainType.Bitcoin);
    reg.register(btc);
    expect(reg.has(ChainType.Bitcoin)).toBe(true);
    expect(reg.has(ChainType.Ethereum)).toBe(false);
    expect(reg.get(ChainType.Bitcoin)).toBe(btc);
    expect(reg.getAll()).toEqual([btc]);
  });

  it('register replaces an existing adapter for the same chain', () => {
    const reg = new ChainRegistry();
    const btc1 = new StubAdapter(ChainType.Bitcoin);
    const btc2 = new StubAdapter(ChainType.Bitcoin);
    reg.register(btc1);
    reg.register(btc2);
    expect(reg.get(ChainType.Bitcoin)).toBe(btc2);
    expect(reg.getAll()).toHaveLength(1);
  });

  it('initAll / connectAll / disconnectAll fan out in parallel', async () => {
    const reg = new ChainRegistry();
    const a = new StubAdapter(ChainType.Bitcoin);
    const b = new StubAdapter(ChainType.Ethereum);
    reg.register(a);
    reg.register(b);
    await reg.initAll(Network.Mainnet);
    expect(a.initCalls).toBe(1);
    expect(b.initCalls).toBe(1);
    await reg.connectAll();
    expect(a.connectCalls + b.connectCalls).toBe(2);
    await reg.disconnectAll();
    expect(a.disconnectCalls + b.disconnectCalls).toBe(2);
  });

  it('getAllBalances returns successful adapters and silently skips failures', async () => {
    const reg = new ChainRegistry();
    reg.register(
      new StubAdapter(ChainType.Bitcoin, {
        balanceImpl: async () => ({ confirmed: 1, unconfirmed: 0, confirmedFiat: 0, unconfirmedFiat: 0 }),
      }),
    );
    reg.register(
      new StubAdapter(ChainType.Ethereum, {
        balanceImpl: async () => {
          throw new Error('rpc down');
        },
      }),
    );
    const balances = await reg.getAllBalances();
    expect(balances[ChainType.Bitcoin]).toBeDefined();
    expect(balances[ChainType.Ethereum]).toBeUndefined();
  });

  it('getAllCachedBalances skips adapters without getCachedBalance', async () => {
    const reg = new ChainRegistry();
    const a = new StubAdapter(ChainType.Bitcoin);
    const b = new StubAdapter(ChainType.Ethereum);
    delete (a as Partial<IChainAdapter>).getCachedBalance;
    b.cachedBalanceImpl = async () => ({ confirmed: 5, unconfirmed: 0, confirmedFiat: 0, unconfirmedFiat: 0 });
    reg.register(a);
    reg.register(b);
    const balances = await reg.getAllCachedBalances();
    expect(balances[ChainType.Bitcoin]).toBeUndefined();
    expect(balances[ChainType.Ethereum]?.confirmed).toBe(5);
  });

  it('getAllCachedBalances skips adapters whose cache returns null', async () => {
    const reg = new ChainRegistry();
    const a = new StubAdapter(ChainType.Bitcoin);
    a.cachedBalanceImpl = async () => null;
    reg.register(a);
    expect(await reg.getAllCachedBalances()).toEqual({});
  });
});
