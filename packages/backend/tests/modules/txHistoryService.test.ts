import { resetChromeStorage } from '../helpers/chromeMock';
import { installFetchMock, jsonResponse, mockFetch, resetFetchMock, restoreFetch } from '../helpers/fetchMock';
import { TxHistoryService } from '../../src/modules/txHistoryService';
import { ChangeType, type AddressEntry, type HistoryEntry } from '../../src/types/cache';
import { Network } from '../../src/types/electrum';
import { ScriptType } from '../../src/types/wallet';
import { accountManager } from '../../src/accountManager';
import { scanManager } from '../../src/scanManager';
import { electrumService } from '../../src/modules/electrumService';
import type { ElectrumTransaction } from '../../src/types/electrum';

const MY_RECEIVE = 'bc1qmyaddr0';
const MY_CHANGE = 'bc1qchange0';
const REMOTE = 'bc1qremote';

function fakeRecvTx(): ElectrumTransaction {
  return {
    txid: 'recvtx1',
    hex: '00',
    version: 2,
    locktime: 0,
    confirmations: 6,
    time: 1_700_000_000,
    vin: [{ txid: 'parent1', vout: 0, sequence: 0xffffffff }],
    vout: [
      {
        value: 0.5,
        n: 0,
        scriptPubKey: { asm: '', hex: '', type: 'witness_v0_keyhash', address: MY_RECEIVE },
      },
    ],
  };
}

function fakeSendTx(): ElectrumTransaction {
  return {
    txid: 'sendtx1',
    hex: '00',
    version: 2,
    locktime: 0,
    confirmations: 1,
    time: 1_700_000_100,
    vin: [{ txid: 'parent2', vout: 0, sequence: 0xffffffff }],
    vout: [
      {
        value: 0.4,
        n: 0,
        scriptPubKey: { asm: '', hex: '', type: 'witness_v0_keyhash', address: REMOTE },
      },
      {
        value: 0.099,
        n: 1,
        scriptPubKey: { asm: '', hex: '', type: 'witness_v0_keyhash', address: MY_CHANGE },
      },
    ],
  };
}

function fakeParentForRecv(): ElectrumTransaction {
  return {
    txid: 'parent1',
    hex: '00',
    version: 2,
    locktime: 0,
    vin: [],
    vout: [
      {
        value: 0.5001,
        n: 0,
        scriptPubKey: { asm: '', hex: '', type: 'witness_v0_keyhash', address: REMOTE },
      },
    ],
  };
}

function fakeParentForSend(): ElectrumTransaction {
  return {
    txid: 'parent2',
    hex: '00',
    version: 2,
    locktime: 0,
    vin: [],
    vout: [
      {
        value: 0.5,
        n: 0,
        scriptPubKey: { asm: '', hex: '', type: 'witness_v0_keyhash', address: MY_RECEIVE },
      },
    ],
  };
}

describe('TxHistoryService.get', () => {
  beforeAll(() => installFetchMock());
  afterAll(() => restoreFetch());

  beforeEach(async () => {
    resetChromeStorage();
    resetFetchMock();
    mockFetch('blockonomics.co/api/price', () => jsonResponse({ price: 60_000 }));

    accountManager.accounts = [];
    accountManager.activeAccountIndex = -1;
    await accountManager.init();
    await accountManager.add({
      name: 'A1',
      index: 0,
      network: Network.Mainnet,
      xpub: 'xpub-test',
      scriptType: ScriptType.P2WPKH,
    });

    const recvAddr: AddressEntry = { address: MY_RECEIVE, firstSeen: 0, lastChecked: 0, everUsed: true };
    const chgAddr: AddressEntry = { address: MY_CHANGE, firstSeen: 0, lastChecked: 0, everUsed: true };
    scanManager.addressCacheReceive.clear();
    scanManager.addressCacheChange.clear();
    scanManager.addressCacheReceive.set(0, recvAddr);
    scanManager.addressCacheChange.set(0, chgAddr);

    const histReceive: Map<number, HistoryEntry> = (
      scanManager as unknown as { historyCacheReceive: Map<number, HistoryEntry> }
    ).historyCacheReceive;
    const histChange: Map<number, HistoryEntry> = (
      scanManager as unknown as { historyCacheChange: Map<number, HistoryEntry> }
    ).historyCacheChange;
    histReceive.clear();
    histChange.clear();
  });

  function setReceiveHistory(txids: string[]): void {
    const map = (scanManager as unknown as { historyCacheReceive: Map<number, HistoryEntry> }).historyCacheReceive;
    map.set(0, { lastChecked: 0, txs: txids.map((id, i) => [id, 800_000 + i] as [string, number]) });
  }

  function setChangeHistory(txids: string[]): void {
    const map = (scanManager as unknown as { historyCacheChange: Map<number, HistoryEntry> }).historyCacheChange;
    map.set(0, { lastChecked: 0, txs: txids.map((id, i) => [id, 800_000 + i] as [string, number]) });
  }

  function mockAllTxs(): void {
    const txMap: Record<string, ElectrumTransaction> = {
      recvtx1: fakeRecvTx(),
      parent1: fakeParentForRecv(),
      sendtx1: fakeSendTx(),
      parent2: fakeParentForSend(),
    };
    jest.spyOn(electrumService, 'getRawTransaction').mockImplementation(async (txid: string) => txMap[txid]);
  }

  afterEach(() => jest.restoreAllMocks());

  it('classifies an incoming UTXO as RECEIVE with the correct amount and fee', async () => {
    setReceiveHistory(['recvtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    const txs = await svc.get();
    const recv = txs.find(t => t.transactionHash === 'recvtx1')!;
    expect(recv.type).toBe('RECEIVE');
    expect(recv.amountBtc).toBeCloseTo(0.5, 8);
    expect(recv.feeBtc).toBeCloseTo(0.0001, 8);
    expect(recv.amountUsd).toBeCloseTo(0.5 * 60_000, 5);
    expect(recv.status).toBe('CONFIRMED');
  });

  it('classifies a self-spend with change as SEND with the external amount', async () => {
    setChangeHistory(['sendtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    const txs = await svc.get();
    const send = txs.find(t => t.transactionHash === 'sendtx1')!;
    expect(send.type).toBe('SEND');
    expect(send.amountBtc).toBeCloseTo(0.4, 8);
    expect(send.receiver).toBe(REMOTE);
    expect(send.sender).toBe(MY_RECEIVE);
  });

  it('returns transactions sorted by timestamp descending', async () => {
    setReceiveHistory(['recvtx1']);
    setChangeHistory(['sendtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    const txs = await svc.get();
    expect(txs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i - 1].timestamp).toBeGreaterThanOrEqual(txs[i].timestamp);
    }
  });

  it('persists history to chrome.storage.local under the cache key', async () => {
    setReceiveHistory(['recvtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    await svc.get();
    const all = await chrome.storage.local.get(null);
    const txKey = Object.keys(all).find(k => k.startsWith('tx_'));
    expect(txKey).toBeDefined();
  });

  it('clearCache removes the persisted entry and clears in-memory caches', async () => {
    setReceiveHistory(['recvtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    await svc.get();
    await svc.clearCache();
    const all = await chrome.storage.local.get(null);
    const txKey = Object.keys(all).find(k => k.startsWith('tx_'));
    expect(txKey).toBeUndefined();
  });

  it('reset() clears in-memory caches without touching storage', async () => {
    setReceiveHistory(['recvtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    await svc.get();
    svc.reset();
    const all = await chrome.storage.local.get(null);
    const txKey = Object.keys(all).find(k => k.startsWith('tx_'));
    expect(txKey).toBeDefined();
  });

  it('addOptimisticPending() inserts a SEND/PENDING entry surfaced by get()', async () => {
    const svc = new TxHistoryService();
    await svc.addOptimisticPending({
      txid: 'pendingtx1',
      toAddress: 'bc1qrecipient',
      fromAddress: MY_RECEIVE,
      amountSats: 100_000,
      feeSats: 1_000,
    });
    const txs = await svc.get();
    const pending = txs.find(t => t.transactionHash === 'pendingtx1')!;
    expect(pending.type).toBe('SEND');
    expect(pending.status).toBe('PENDING');
    expect(pending.amountBtc).toBeCloseTo(0.001, 8);
    expect(pending.feeBtc).toBeCloseTo(0.00001, 8);
    expect(pending.receiver).toBe('bc1qrecipient');
    expect(pending.sender).toBe(MY_RECEIVE);
    expect(pending.amountUsd).toBeCloseTo(0.001 * 60_000, 5);
  });

  it('addOptimisticPending() is a no-op when an entry for the txid already exists', async () => {
    setReceiveHistory(['recvtx1']);
    mockAllTxs();
    const svc = new TxHistoryService();
    await svc.get(); // populates cache with the canonical recvtx1 entry
    await svc.addOptimisticPending({
      txid: 'recvtx1',
      toAddress: 'bc1qsomeoneelse',
      fromAddress: MY_RECEIVE,
      amountSats: 999,
      feeSats: 1,
    });
    const txs = await svc.get();
    const recv = txs.find(t => t.transactionHash === 'recvtx1')!;
    expect(recv.type).toBe('RECEIVE');
    expect(recv.receiver).not.toBe('bc1qsomeoneelse');
  });

  it('addOptimisticPending() is replaced by the canonical entry once the scanner picks the tx up', async () => {
    const svc = new TxHistoryService();
    await svc.addOptimisticPending({
      txid: 'recvtx1',
      toAddress: MY_RECEIVE,
      fromAddress: '',
      amountSats: 50_000,
      feeSats: 500,
    });
    expect((await svc.get()).find(t => t.transactionHash === 'recvtx1')!.status).toBe('PENDING');

    setReceiveHistory(['recvtx1']);
    mockAllTxs();
    const txs = await svc.get();
    const tx = txs.find(t => t.transactionHash === 'recvtx1')!;
    expect(tx.status).toBe('CONFIRMED');
    expect(tx.type).toBe('RECEIVE');
  });
});
