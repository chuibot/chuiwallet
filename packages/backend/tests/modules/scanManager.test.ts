import { computeForwardScanWindow, ScanManager } from '../../src/scanManager';
import { ChangeType } from '../../src/types/cache';
import { Network } from '../../src/types/electrum';
import type { Account } from '../../src/types/wallet';
import { ScriptType } from '../../src/types/wallet';
import { defaultPreferences, preferenceManager } from '../../src/preferenceManager';
import { accountManager } from '../../src/accountManager';

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
});
