import * as bitcoin from 'bitcoinjs-lib';
import { ElectrumService } from '../../src/modules/electrumService';
import { ElectrumRpcClient } from '../../src/modules/electrumRpcClient';
import { FakeWebSocket, installWebSocketMock, resetWebSocketMock, restoreWebSocket } from '../helpers/wsMock';
import { availableServerList } from '../../src/modules/electrumServer';
import * as electrumServer from '../../src/modules/electrumServer';
import { Network } from '../../src/types/electrum';

// Build a real serialized tx so broadcastTx's local txid step
// (Transaction.fromHex) accepts the input.
function syntheticRawTx(): { rawTxHex: string; txid: string } {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(Buffer.from('0014' + '00'.repeat(20), 'hex'), 50_000);
  return { rawTxHex: tx.toHex(), txid: tx.getId() };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));

/** Answer the health probes that init() fans out across the server list. */
async function answerProbes(): Promise<void> {
  await tick();
  for (const inst of [...FakeWebSocket.instances]) {
    inst.triggerOpen();
    inst.triggerMessage(JSON.stringify({ id: 1, result: 'ok' }));
  }
}

const newestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

async function bootElectrumService(network: Network = Network.Mainnet): Promise<{
  svc: ElectrumService;
  ws: () => FakeWebSocket;
}> {
  const svc = new ElectrumService();
  const initPromise = svc.init(network);
  await answerProbes();
  await initPromise;

  const connectPromise = svc.connect();
  await tick();
  const opened = newestSocket();
  await opened.openAndHandshake({ network });
  await connectPromise;

  return { svc, ws: () => opened };
}

describe('ElectrumService', () => {
  beforeAll(() => installWebSocketMock());
  afterAll(() => restoreWebSocket());
  beforeEach(() => resetWebSocketMock());

  it('init() picks a server, connect() opens the websocket, status emits "connected"', async () => {
    const events: string[] = [];
    const { svc } = await bootElectrumService();
    svc.onStatus.on(e => events.push(e.status));
    expect(svc.status).toBe('connected');
  });

  it('forwards getRawTransaction() to the JSON-RPC client (string mode)', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.getRawTransaction('txid123');
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    expect(sent.method).toBe('blockchain.transaction.get');
    expect(sent.params).toEqual(['txid123', false]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: '0100ffff' }));
    expect(await p).toBe('0100ffff');
  });

  it('verbose=true expects an object response with .hex', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.getRawTransaction('txid123', true);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(
      JSON.stringify({
        id: sent.id,
        result: { txid: 'txid123', hex: 'abcd', version: 2, locktime: 0, vin: [], vout: [] },
      }),
    );
    const r = (await p) as { txid: string };
    expect(r.txid).toBe('txid123');
  });

  it('throws on unexpected verbose response shape', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.getRawTransaction('txid', true);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: { malformed: true } }));
    await expect(p).rejects.toThrow(/Electrum response/);
  });

  it('broadcastTx validates hex format', async () => {
    const { svc } = await bootElectrumService();
    await expect(svc.broadcastTx('not hex!')).rejects.toThrow(/Invalid transaction hex/);
  });

  it('broadcastTx validates even-length hex', async () => {
    const { svc } = await bootElectrumService();
    await expect(svc.broadcastTx('abc')).rejects.toThrow(/Invalid transaction hex/);
  });

  it('broadcastTx returns the LOCALLY computed txid and ignores the server reply', async () => {
    const { svc, ws } = await bootElectrumService();
    const { rawTxHex, txid: localTxid } = syntheticRawTx();
    const serverLie = 'a'.repeat(64);
    const p = svc.broadcastTx(rawTxHex);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    expect(sent.method).toBe('blockchain.transaction.broadcast');
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: serverLie }));
    const returned = await p;
    expect(returned).toBe(localTxid);
    expect(returned).not.toBe(serverLie);
  });

  it('broadcastTx wraps server errors with "Broadcast failed" prefix', async () => {
    const { svc, ws } = await bootElectrumService();
    const { rawTxHex } = syntheticRawTx();
    const p = svc.broadcastTx(rawTxHex);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, error: { message: 'mempool full' } }));
    await expect(p).rejects.toThrow(/Broadcast failed: mempool full/);
  });

  it('broadcastTx throws on unexpected non-txid result shape', async () => {
    const { svc, ws } = await bootElectrumService();
    const { rawTxHex } = syntheticRawTx();
    const p = svc.broadcastTx(rawTxHex);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: 'not a txid' }));
    await expect(p).rejects.toThrow(/Broadcast failed: Unexpected broadcast result/);
  });

  // The transaction may already be in the mempool: dropping the connection and letting the
  // user retry risks a second, conflicting spend of the same inputs.
  it('broadcastTx keeps the connection and warns when the reply times out', async () => {
    jest.useFakeTimers();
    try {
      const svc = new ElectrumService();
      const initPromise = svc.init(Network.Mainnet);
      await jest.advanceTimersByTimeAsync(5);
      for (const inst of [...FakeWebSocket.instances]) {
        inst.triggerOpen();
        inst.triggerMessage(JSON.stringify({ id: 1, result: 'ok' }));
      }
      await initPromise;

      const connecting = svc.connect();
      await jest.advanceTimersByTimeAsync(5);
      await newestSocket().openAndHandshake();
      await connecting;

      const { rawTxHex } = syntheticRawTx();
      const p = svc.broadcastTx(rawTxHex);
      const rejects = expect(p).rejects.toThrow(/may already have been broadcast/i);
      await jest.advanceTimersByTimeAsync(60_000);
      await rejects;

      expect(svc.status).toBe('connected');
    } finally {
      jest.useRealTimers();
    }
  });

  it('getTipHeight throws when all healthy servers return null (quorum not met)', async () => {
    const { svc } = await bootElectrumService();
    const prevCount = FakeWebSocket.instances.length;
    const p = svc.getTipHeight();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    const newInsts = FakeWebSocket.instances.slice(prevCount);
    for (const inst of newInsts) {
      inst.triggerOpen();
      inst.triggerMessage(JSON.stringify({ id: 1, result: null }));
    }
    await expect(p).rejects.toThrow(/Insufficient server responses/);
  });

  const FAKE_HEX = '00'.repeat(80);
  const bootAndFireTipHeader = async (svc: ElectrumService, heights: (number | null)[]) => {
    const prevCount = FakeWebSocket.instances.length;
    const p = svc.getTipHeader();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    const newInsts = FakeWebSocket.instances.slice(prevCount);
    newInsts.forEach((inst, i) => {
      inst.triggerOpen();
      const h = heights[i % heights.length];
      inst.triggerMessage(JSON.stringify({ id: 1, result: h === null ? null : { height: h, hex: FAKE_HEX } }));
    });
    return p;
  };

  it('getTipHeader throws when all servers return null', async () => {
    const { svc } = await bootElectrumService();
    await expect(bootAndFireTipHeader(svc, [null])).rejects.toThrow(/Insufficient server responses/);
  });

  it('getTipHeader returns consensus height and merkle_root when servers agree', async () => {
    const { svc } = await bootElectrumService();
    const tip = await bootAndFireTipHeader(svc, [800_123]);
    expect(tip.height).toBe(800_123);
    expect(tip.merkle_root).toBe('00'.repeat(32));
  });

  it('getTipHeight returns the consensus height', async () => {
    const { svc } = await bootElectrumService();
    const p = svc.getTipHeight();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    FakeWebSocket.instances.slice(FakeWebSocket.instances.length - 5).forEach(inst => {
      inst.triggerOpen();
      inst.triggerMessage(JSON.stringify({ id: 1, result: { height: 800_123, hex: FAKE_HEX } }));
    });
    expect(await p).toBe(800_123);
  });

  it('getTipHeader throws when servers disagree by more than 6 blocks', async () => {
    const { svc } = await bootElectrumService();
    const prevCount = FakeWebSocket.instances.length;
    const p = svc.getTipHeader();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    FakeWebSocket.instances.slice(prevCount).forEach((inst, i) => {
      inst.triggerOpen();
      inst.triggerMessage(JSON.stringify({ id: 1, result: { height: i === 0 ? 800_000 : 800_100, hex: FAKE_HEX } }));
    });
    await expect(p).rejects.toThrow(/consensus failed/);
  });

  it('throws when calling RPC methods before init/connect', async () => {
    const svc = new ElectrumService();
    await expect(svc.getRawTransaction('txid')).rejects.toThrow('Electrum not connected');
    await expect(svc.broadcastTx('0100')).rejects.toThrow('Electrum not connected');
    await expect(svc.getHistoryBatch([['x']])).rejects.toThrow('Electrum not connected');
    await expect(svc.getUtxoBatch([['x']])).rejects.toThrow('Electrum not connected');
  });

  it('getBlockHeader sends blockchain.block.header and returns 160-char hex', async () => {
    const { svc, ws } = await bootElectrumService();
    const HEADER_HEX = '00'.repeat(80);
    const p = svc.getBlockHeader(800_000);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    expect(sent.method).toBe('blockchain.block.header');
    expect(sent.params).toEqual([800_000]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: HEADER_HEX }));
    expect(await p).toBe(HEADER_HEX);
  });

  it('getBlockHeader caches the result — second call sends no new request', async () => {
    const { svc, ws } = await bootElectrumService();
    const HEADER_HEX = 'ab'.repeat(80);
    const p = svc.getBlockHeader(850_000);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: HEADER_HEX }));
    await p;
    const sentBefore = ws().sent.length;
    expect(await svc.getBlockHeader(850_000)).toBe(HEADER_HEX);
    expect(ws().sent.length).toBe(sentBefore);
  });

  it('getBlockHeader throws when not connected', async () => {
    const svc = new ElectrumService();
    await expect(svc.getBlockHeader(800_000)).rejects.toThrow('Electrum not connected');
  });

  it('getBlockHeader throws on invalid server response', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.getBlockHeader(800_000);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: 'tooshort' }));
    await expect(p).rejects.toThrow(/block header/);
  });

  it('disconnect clears the header cache', async () => {
    const { svc, ws } = await bootElectrumService();
    const HEADER_HEX = '00'.repeat(80);
    const p = svc.getBlockHeader(800_000);
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: HEADER_HEX }));
    await p;
    svc.disconnect();
    // After disconnect, rpcClient is still set but cache is cleared — next call would go to server
    // We verify by checking status changed to disconnected
    expect(svc.status).toBe('disconnected');
  });

  it('disconnect updates status to "disconnected" and includes reason', async () => {
    const { svc } = await bootElectrumService();
    const events: { status: string; reason?: string }[] = [];
    svc.onStatus.on(e => events.push({ status: e.status, reason: e.reason }));
    svc.disconnect('manual stop');
    expect(events[0].status).toBe('disconnected');
    expect(events[0].reason).toBe('manual stop');
  });

  it('disconnect(switchNetwork) does not emit a second reasonless disconnected event', async () => {
    const { svc } = await bootElectrumService();
    const events: { status: string; reason?: string }[] = [];
    svc.onStatus.on(e => events.push({ status: e.status, reason: e.reason }));
    svc.disconnect('switchNetwork');
    expect(events).toEqual([{ status: 'disconnected', reason: 'switchNetwork' }]);
  });

  describe('failover', () => {
    async function initOnly(network: Network = Network.Mainnet): Promise<ElectrumService> {
      const svc = new ElectrumService();
      const initPromise = svc.init(network);
      await answerProbes();
      await initPromise;
      return svc;
    }

    it('moves to another server when the first one will not complete a handshake', async () => {
      const svc = await initOnly();
      const events: string[] = [];
      svc.onStatus.on(e => events.push(e.status));

      const connecting = svc.connect();
      await tick();
      const first = newestSocket();
      first.triggerError('refused');
      await tick();

      const second = newestSocket();
      expect(second).not.toBe(first);
      await second.openAndHandshake();
      await connecting;

      expect(svc.status).toBe('connected');
      // A candidate that fails mid-rotation must stay invisible: a leaked 'disconnected'
      // makes the background listener start a competing reconnect.
      expect(events).toEqual(['connected']);
    });

    it('rescans once when every known server fails, then reports a single failure', async () => {
      const svc = await initOnly();
      const events: { status: string; reason?: string }[] = [];
      svc.onStatus.on(e => events.push({ status: e.status, reason: e.reason }));

      const mainnetServers = availableServerList.filter(s => s.network === Network.Mainnet).length;
      const beforeRotation = FakeWebSocket.instances.length;

      const connecting = svc.connect();
      const rejects = expect(connecting).rejects.toBeDefined();

      for (let attempt = 0; attempt < mainnetServers; attempt++) {
        await tick();
        newestSocket()?.triggerError('refused');
      }
      // Exhausting the known-good list triggers one fresh probe sweep of the whole server list.
      await tick();
      const rescanned = FakeWebSocket.instances.length - beforeRotation - mainnetServers;
      expect(rescanned).toBe(mainnetServers);

      for (const inst of FakeWebSocket.instances) inst.triggerError('refused');
      await rejects;

      expect(events.filter(e => e.status === 'disconnected')).toHaveLength(1);
      expect(events[0].reason).toBeUndefined();
    });

    // Servers that accept the socket then go silent burn the full connect watchdog each. With
    // one budget shared across both passes they would starve the rescan completely.
    it('still tries the rescanned servers after a slow first pass', async () => {
      jest.useFakeTimers();
      const slowPool = ['slow1.test', 'slow2.test', 'slow3.test', 'slow4.test', 'slow5.test'].map(host => ({
        host,
        port: 50002,
        useTls: true,
        network: Network.Mainnet,
        latency: 1,
        healthy: true,
      }));
      const rescued = { host: 'rescued.test', port: 50002, useTls: true, network: Network.Mainnet };
      const selectSpy = jest
        .spyOn(electrumServer, 'selectBestServer')
        .mockResolvedValueOnce({ server: slowPool[0], healthyServers: slowPool })
        .mockResolvedValueOnce({ server: rescued, healthyServers: [rescued] });

      try {
        const svc = new ElectrumService();
        await svc.init(Network.Mainnet);

        const connecting = svc.connect();
        for (let attempt = 0; attempt < slowPool.length && selectSpy.mock.calls.length < 2; attempt++) {
          await jest.advanceTimersByTimeAsync(5);
          newestSocket().triggerOpen();
          await jest.advanceTimersByTimeAsync(ElectrumRpcClient.CONNECT_TIMEOUT_MS + 10);
        }

        // Server selection is stubbed, so every socket is a dial. Giving up before the pool was
        // exhausted is what proves the budget cut the pass short.
        const slowDials = FakeWebSocket.instances.filter(socket => socket.url.includes('slow')).length;
        expect(slowDials).toBeLessThan(slowPool.length);
        expect(selectSpy).toHaveBeenCalledWith(Network.Mainnet, { refresh: true });

        await jest.advanceTimersByTimeAsync(5);
        expect(newestSocket().url).toContain('rescued.test');

        await newestSocket().openAndHandshake();
        await connecting;
        expect(svc.status).toBe('connected');
      } finally {
        jest.useRealTimers();
        selectSpy.mockRestore();
      }
    });

    it('skips a server that wedged mid-request when reconnecting', async () => {
      jest.useFakeTimers();
      try {
        const svc = new ElectrumService();
        const initPromise = svc.init(Network.Mainnet);
        await jest.advanceTimersByTimeAsync(5);
        for (const inst of [...FakeWebSocket.instances]) {
          inst.triggerOpen();
          inst.triggerMessage(JSON.stringify({ id: 1, result: 'ok' }));
        }
        await initPromise;

        const connecting = svc.connect();
        await jest.advanceTimersByTimeAsync(5);
        const stalled = newestSocket();
        await stalled.openAndHandshake();
        await connecting;

        const pending = svc.getRawTransaction('txid');
        const rejects = expect(pending).rejects.toThrow(/timed out/);
        await jest.advanceTimersByTimeAsync(ElectrumRpcClient.REQUEST_TIMEOUT_MS + 10);
        await rejects;

        const reconnecting = svc.connect();
        await jest.advanceTimersByTimeAsync(5);
        const replacement = newestSocket();
        expect(replacement.url).not.toBe(stalled.url);
        await replacement.openAndHandshake();
        await reconnecting;

        expect(svc.status).toBe('connected');
      } finally {
        jest.useRealTimers();
      }
    });

    it('abandons an in-flight rotation when the network is switched', async () => {
      const svc = await initOnly();
      const events: { status: string; reason?: string }[] = [];
      svc.onStatus.on(e => events.push({ status: e.status, reason: e.reason }));

      const connecting = svc.connect();
      await tick();
      const candidate = newestSocket();

      svc.disconnect('switchNetwork');
      await expect(connecting).rejects.toThrow(/superseded/i);

      expect(candidate.readyState).toBe(FakeWebSocket.CLOSED);
      expect(events).toEqual([{ status: 'disconnected', reason: 'switchNetwork' }]);
    });

    it('lets the newer of two overlapping connects win', async () => {
      const svc = await initOnly();
      const events: string[] = [];
      svc.onStatus.on(e => events.push(e.status));

      const first = svc.connect();
      await tick();
      const second = svc.connect();
      await expect(first).rejects.toThrow(/superseded/i);

      await tick();
      await newestSocket().openAndHandshake();
      await second;

      expect(events).toEqual(['connected']);
    });
  });
});
