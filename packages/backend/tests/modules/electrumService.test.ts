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

  it('getTipHeight returns 0 when the server returns no header', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.getTipHeight();
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: null }));
    expect(await p).toBe(0);
  });

  it('getTipHeight returns the height when present', async () => {
    const { svc, ws } = await bootElectrumService();
    const p = svc.getTipHeight();
    const sent = JSON.parse(ws().sent[ws().sent.length - 1]);
    ws().triggerMessage(JSON.stringify({ id: sent.id, result: { height: 800_123 } }));
    expect(await p).toBe(800_123);
  });

  it('throws when calling RPC methods before init/connect', async () => {
    const svc = new ElectrumService();
    await expect(svc.getRawTransaction('txid')).rejects.toThrow('Electrum not connected');
    await expect(svc.broadcastTx('0100')).rejects.toThrow('Electrum not connected');
    await expect(svc.getHistoryBatch([['x']])).rejects.toThrow('Electrum not connected');
    await expect(svc.getUtxoBatch([['x']])).rejects.toThrow('Electrum not connected');
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
