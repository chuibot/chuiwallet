import { computeForwardScanWindow, defaultScanConfig, ScanManager } from '../../src/scanManager';
import { ChangeType } from '../../src/types/cache';
import type { AddressEntry, HistoryEntry, ScanEvent, UtxoEntry } from '../../src/types/cache';
import { Network } from '../../src/types/electrum';
import type { Account } from '../../src/types/wallet';
import { ScriptType } from '../../src/types/wallet';
import { defaultPreferences, preferenceManager } from '../../src/preferenceManager';
import { accountManager } from '../../src/accountManager';
import { electrumService } from '../../src/modules/electrumService';
import { walletManager } from '../../src/walletManager';

type ScanInternals = {
  addressCacheReceive: Map<number, AddressEntry>;
  historyCacheReceive: Map<number, HistoryEntry>;
  utxoCacheReceive: Map<number, UtxoEntry>;
  runInit: (epoch: number) => Promise<void>;
  saveHistory: () => Promise<void>;
  saveAddress: () => Promise<void>;
  saveUtxo: () => Promise<void>;
  scan: (indices: number[], changeType: ChangeType, ctx: unknown) => Promise<void>;
  currentContext: () => unknown;
};

type CtxState = {
  network: Network;
  activeAccountIndex: number;
  hdAccountIndex: number;
};

function makeAccount(network: Network, hdIndex: number): Account {
  return {
    name: `Account #${hdIndex + 1}`,
    index: hdIndex,
    network,
    xpub: '',
    scriptType: ScriptType.P2WPKH,
  };
}

function installContext(state: CtxState) {
  jest.spyOn(preferenceManager, 'get').mockImplementation(() => ({
    ...defaultPreferences,
    activeNetwork: state.network,
    activeAccountIndex: state.activeAccountIndex,
  }));
  jest
    .spyOn(accountManager, 'getActiveAccount')
    .mockImplementation(() => makeAccount(state.network, state.hdAccountIndex));
  accountManager.activeAccountIndex = state.activeAccountIndex;
}

describe('computeForwardScanWindow', () => {
  it('returns gap+1 from a fresh wallet (no usage, nothing scanned)', () => {
    expect(computeForwardScanWindow(-1, 200, -1)).toBe(201);
  });

  it('returns 0 when scanned exactly to the gap boundary', () => {
    expect(computeForwardScanWindow(5, 20, 25)).toBe(0);
  });

  it('extends the window by exactly one when one new used index appears', () => {
    expect(computeForwardScanWindow(6, 20, 25)).toBe(1);
  });

  it('returns negative when scanned beyond the gap (caller treats <=0 as up-to-date)', () => {
    expect(computeForwardScanWindow(5, 20, 26)).toBe(-1);
  });

  it('clamps a negative highestUsed to 0', () => {
    expect(computeForwardScanWindow(-1, 20, 0)).toBe(20);
  });

  it('handles a small gap limit', () => {
    expect(computeForwardScanWindow(0, 1, 0)).toBe(1);
    expect(computeForwardScanWindow(0, 1, 1)).toBe(0);
  });
});

describe('ScanManager — init dedupe', () => {
  let ctxState: CtxState;

  beforeEach(() => {
    ctxState = { network: Network.Mainnet, activeAccountIndex: 0, hdAccountIndex: 0 };
    installContext(ctxState);
  });

  afterEach(() => {
    accountManager.activeAccountIndex = -1;
    jest.restoreAllMocks();
  });

  it('returns the same in-flight promise for concurrent init calls', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as ScanInternals, 'runInit')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5)));

    const a = sm.init();
    const b = sm.init();

    expect(a).toBe(b);
    await a;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not reload after the current epoch is initialized', async () => {
    const sm = new ScanManager();
    const spy = jest.spyOn(sm as unknown as ScanInternals, 'runInit').mockResolvedValue(undefined);

    await sm.init();
    await sm.init();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('serializes init after clear into the next epoch', async () => {
    const sm = new ScanManager();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>(resolveStarted => {
      jest.spyOn(sm as unknown as ScanInternals, 'runInit').mockImplementation(async epoch => {
        order.push(`start:${epoch}`);
        if (epoch === 0) {
          resolveStarted();
          await new Promise<void>(resolve => {
            releaseFirst = resolve;
          });
        }
        order.push(`end:${epoch}`);
      });
    });

    const first = sm.init();
    await firstStarted;
    sm.clear();
    const second = sm.init();
    await Promise.resolve();

    expect(order).toEqual(['start:0']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['start:0', 'end:0', 'start:1', 'end:1']);
  });
});

describe('ScanManager — concurrent scan dedupe', () => {
  let ctxState: CtxState;

  beforeEach(() => {
    ctxState = { network: Network.Mainnet, activeAccountIndex: 0, hdAccountIndex: 0 };
    installContext(ctxState);
  });

  afterEach(() => {
    accountManager.activeAccountIndex = -1;
    jest.restoreAllMocks();
  });

  it('forwardScan returns the same in-flight promise for concurrent calls on the same chain', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const a = sm.forwardScan(ChangeType.External);
    const b = sm.forwardScan(ChangeType.External);
    expect(a).toBe(b);
    await a;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('forwardScan runs External and Internal in parallel (different inflight slots)', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const ext = sm.forwardScan(ChangeType.External);
    const int = sm.forwardScan(ChangeType.Internal);
    expect(ext).not.toBe(int);
    await Promise.all([ext, int]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('forwardScan starts a fresh scan after the previous one resolves', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5)));

    await sm.forwardScan(ChangeType.External);
    await sm.forwardScan(ChangeType.External);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('backfillScan dedupes concurrent calls on the same chain', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runBackfillScan: () => Promise<void> }, 'runBackfillScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const a = sm.backfillScan(ChangeType.External);
    const b = sm.backfillScan(ChangeType.External);
    expect(a).toBe(b);
    await a;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('forwardScan and backfillScan can run in parallel (independent inflight maps)', async () => {
    const sm = new ScanManager();
    const fwdSpy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));
    const bfSpy = jest
      .spyOn(sm as unknown as { runBackfillScan: () => Promise<void> }, 'runBackfillScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    await Promise.all([sm.forwardScan(ChangeType.External), sm.backfillScan(ChangeType.External)]);
    expect(fwdSpy).toHaveBeenCalledTimes(1);
    expect(bfSpy).toHaveBeenCalledTimes(1);
  });

  it('forwardScan clears the inflight slot on rejection so the next call restarts', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(sm.forwardScan(ChangeType.External)).rejects.toThrow('boom');
    await sm.forwardScan(ChangeType.External);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('backfillScan clears the inflight slot on rejection so the next call restarts', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runBackfillScan: () => Promise<void> }, 'runBackfillScan')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(sm.backfillScan(ChangeType.External)).rejects.toThrow('boom');
    await sm.backfillScan(ChangeType.External);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('ScanManager — hot receive polling', () => {
  let ctxState: CtxState;

  beforeEach(() => {
    ctxState = { network: Network.Mainnet, activeAccountIndex: 0, hdAccountIndex: 0 };
    installContext(ctxState);
  });

  afterEach(() => {
    accountManager.activeAccountIndex = -1;
    jest.restoreAllMocks();
  });

  it('scans the next receive lookahead window', async () => {
    const sm = new ScanManager({ ...defaultScanConfig, hotReceiveLookahead: 3 });
    const internal = sm as unknown as ScanInternals;
    Object.defineProperty(electrumService, 'status', { value: 'connected', configurable: true });
    const scanSpy = jest.spyOn(internal, 'scan').mockResolvedValue();
    jest.spyOn(walletManager, 'deriveAddress').mockImplementation((_chain, index) => {
      const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1q530dz4h80kwlzywlhx2qn0k6vdtftd93c499yq'];
      return addresses[index % addresses.length];
    });

    await sm.scanHotReceiveAddresses();

    expect(scanSpy).toHaveBeenCalledWith([0, 1, 2], ChangeType.External, expect.anything());
  });

  it('includes live receive indices outside the next lookahead window', async () => {
    const sm = new ScanManager({ ...defaultScanConfig, hotReceiveLookahead: 2 });
    const internal = sm as unknown as ScanInternals;
    sm.nextReceiveIndex = 5;
    Object.defineProperty(electrumService, 'status', { value: 'connected', configurable: true });
    internal.addressCacheReceive.set(1, {
      address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      firstSeen: 0,
      lastChecked: 0,
      everUsed: true,
    });
    internal.addressCacheReceive.set(2, {
      address: 'bc1q530dz4h80kwlzywlhx2qn0k6vdtftd93c499yq',
      firstSeen: 0,
      lastChecked: 0,
      everUsed: true,
    });
    internal.historyCacheReceive.set(1, { lastChecked: 0, txs: [['a', 0]] });
    internal.utxoCacheReceive.set(2, {
      lastChecked: 0,
      utxos: [{ txid: 'b'.repeat(64), vout: 0, value: 10_000, height: 800_000 }],
    });
    const scanSpy = jest.spyOn(internal, 'scan').mockResolvedValue();
    jest.spyOn(walletManager, 'deriveAddress').mockImplementation((_chain, index) => {
      const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1q530dz4h80kwlzywlhx2qn0k6vdtftd93c499yq'];
      return addresses[index % addresses.length];
    });

    await sm.scanHotReceiveAddresses();

    expect(scanSpy).toHaveBeenCalledWith([1, 2, 5, 6], ChangeType.External, expect.anything());
  });

  it('does not derive or scan while disconnected', async () => {
    const sm = new ScanManager({ ...defaultScanConfig, hotReceiveLookahead: 3 });
    const internal = sm as unknown as ScanInternals;
    Object.defineProperty(electrumService, 'status', { value: 'disconnected', configurable: true });
    const scanSpy = jest.spyOn(internal, 'scan').mockResolvedValue();
    const deriveSpy = jest
      .spyOn(walletManager, 'deriveAddress')
      .mockReturnValue('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');

    await sm.scanHotReceiveAddresses();

    expect(deriveSpy).not.toHaveBeenCalled();
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('dedupes concurrent hot scans', async () => {
    const sm = new ScanManager({ ...defaultScanConfig, hotReceiveLookahead: 1 });
    const internal = sm as unknown as ScanInternals;
    Object.defineProperty(electrumService, 'status', { value: 'connected', configurable: true });
    jest.spyOn(walletManager, 'deriveAddress').mockReturnValue('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    const scanSpy = jest
      .spyOn(internal, 'scan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const a = sm.scanHotReceiveAddresses();
    const b = sm.scanHotReceiveAddresses();
    expect(a).toBe(b);
    await a;
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });
});

describe('ScanManager — context isolation and stale-fence', () => {
  let ctxState: CtxState;

  beforeEach(() => {
    ctxState = { network: Network.Mainnet, activeAccountIndex: 0, hdAccountIndex: 0 };
    installContext(ctxState);
  });

  afterEach(() => {
    accountManager.activeAccountIndex = -1;
    jest.restoreAllMocks();
  });

  it('uses separate inflight slots when activeAccountIndex changes mid-flight', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const accountA = sm.forwardScan(ChangeType.External);
    ctxState.activeAccountIndex = 1;
    ctxState.hdAccountIndex = 1;
    accountManager.activeAccountIndex = 1;
    const accountB = sm.forwardScan(ChangeType.External);
    expect(accountA).not.toBe(accountB);
    await Promise.all([accountA, accountB]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('uses separate inflight slots when activeNetwork changes mid-flight', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const mainnet = sm.forwardScan(ChangeType.External);
    ctxState.network = Network.Testnet;
    const testnet = sm.forwardScan(ChangeType.External);
    expect(mainnet).not.toBe(testnet);
    await Promise.all([mainnet, testnet]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('clear() drops inflight entries so a fresh scan starts after switch', async () => {
    const sm = new ScanManager();
    const spy = jest
      .spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan')
      .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)));

    const before = sm.forwardScan(ChangeType.External);
    sm.clear();
    const after = sm.forwardScan(ChangeType.External);
    expect(before).not.toBe(after);
    await Promise.all([before, after]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('forwardScan rejects without scanning when prefs and accountManager disagree on accountListIndex', async () => {
    const sm = new ScanManager();
    const spy = jest.spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan');
    accountManager.activeAccountIndex = 99;
    await sm.forwardScan(ChangeType.External);
    expect(spy).not.toHaveBeenCalled();
  });

  it('forwardScan rejects without scanning when prefs and active account disagree on network', async () => {
    const sm = new ScanManager();
    const spy = jest.spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan');
    jest.spyOn(accountManager, 'getActiveAccount').mockReturnValue(makeAccount(Network.Testnet, 0));
    await sm.forwardScan(ChangeType.External);
    expect(spy).not.toHaveBeenCalled();
  });

  it('finally cleanup respects identity: an orphaned old promise does not delete a fresh slot', async () => {
    const sm = new ScanManager();
    let resolveFirst!: () => void;
    let runCount = 0;
    jest.spyOn(sm as unknown as { runForwardScan: () => Promise<void> }, 'runForwardScan').mockImplementation(() => {
      runCount++;
      if (runCount === 1) return new Promise<void>(r => (resolveFirst = r));
      return new Promise(resolve => setTimeout(resolve, 5));
    });

    const orphaned = sm.forwardScan(ChangeType.External);
    sm.clear();
    const fresh = sm.forwardScan(ChangeType.External);
    expect(orphaned).not.toBe(fresh);
    resolveFirst();
    await orphaned;
    const same = sm.forwardScan(ChangeType.External);
    expect(same).toBe(fresh);
    await fresh;
  });

  it('aborts after a context flip during saveHistory: no further Electrum work, no final emit', async () => {
    const sm = new ScanManager();
    const internal = sm as unknown as ScanInternals;

    internal.addressCacheReceive.set(0, {
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      firstSeen: 0,
      lastChecked: 0,
      everUsed: false,
    });

    Object.defineProperty(electrumService, 'status', { value: 'connected', configurable: true });
    jest.spyOn(electrumService, 'getHistoryBatch').mockResolvedValue([[{ tx_hash: 'a', height: 1 }]]);
    const utxoSpy = jest.spyOn(electrumService, 'getUtxoBatch').mockResolvedValue([[]]);

    const events: ScanEvent[] = [];
    sm.onStatus.on(e => events.push(e));

    jest.spyOn(internal, 'saveHistory').mockImplementation(async () => {
      sm.clear();
    });

    const ctx = internal.currentContext();
    expect(ctx).not.toBeNull();
    await internal.scan([0], ChangeType.External, ctx);

    expect(utxoSpy).not.toHaveBeenCalled();
    expect(events.some(e => e.utxoChanged || e.historyChanged)).toBe(false);
  });

  it('keeps scan results aligned when a sparse batch has a missing address', async () => {
    const sm = new ScanManager();
    const internal = sm as unknown as ScanInternals;
    internal.addressCacheReceive.set(0, {
      address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      firstSeen: 0,
      lastChecked: 0,
      everUsed: false,
    });
    internal.addressCacheReceive.set(2, {
      address: 'bc1q530dz4h80kwlzywlhx2qn0k6vdtftd93c499yq',
      firstSeen: 0,
      lastChecked: 0,
      everUsed: false,
    });
    Object.defineProperty(electrumService, 'status', { value: 'connected', configurable: true });
    jest.spyOn(electrumService, 'getHistoryBatch').mockResolvedValue([[], [{ tx_hash: 'c'.repeat(64), height: 1 }]]);
    jest.spyOn(electrumService, 'getUtxoBatch').mockResolvedValue([[], []]);

    const ctx = internal.currentContext();
    expect(ctx).not.toBeNull();
    await internal.scan([0, 1, 2], ChangeType.External, ctx);

    expect(internal.historyCacheReceive.get(2)?.txs).toEqual([['c'.repeat(64), 1]]);
  });
});
