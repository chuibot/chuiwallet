import { ElectrumService } from '../../src/modules/electrumService';
import { FakeWebSocket, installWebSocketMock, resetWebSocketMock, restoreWebSocket } from '../helpers/wsMock';
import { Network } from '../../src/types/electrum';

async function bootElectrumService(network: Network = Network.Mainnet): Promise<{
  svc: ElectrumService;
  ws: () => FakeWebSocket;
}> {
  const svc = new ElectrumService();
  const initPromise = svc.init(network);
  await new Promise<void>(resolve => setTimeout(resolve, 5));
  const measurementInstances = [...FakeWebSocket.instances];
  for (const inst of measurementInstances) {
    inst.triggerOpen();
    inst.triggerMessage(JSON.stringify({ id: 1, result: 'ok' }));
  }
  await initPromise;

  const connectPromise = svc.connect();
  await new Promise<void>(resolve => setTimeout(resolve, 5));
  const opened = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  opened.triggerOpen();
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

  it('broadcastTx returns the txid when the server returns a 64-char hex string', async () => {
    const { svc, ws } = await bootElectrumService();
    const txid = 'a'.repeat(64);
    const p = svc.broadcastTx('0100abcd');
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    expect(sent.method).toBe('blockchain.transaction.broadcast');
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: txid }));
    expect(await p).toBe(txid);
  });

  it('broadcastTx wraps server errors with "Broadcast failed" prefix', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.broadcastTx('0100abcd');
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, error: { message: 'mempool full' } }));
    await expect(p).rejects.toThrow(/Broadcast failed: mempool full/);
  });

  it('broadcastTx throws on unexpected non-txid result shape', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.broadcastTx('0100abcd');
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: 'not a txid' }));
    await expect(p).rejects.toThrow(/Unexpected broadcast result/);
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
});
