import { FakeWebSocket, installWebSocketMock, resetWebSocketMock, restoreWebSocket } from '../helpers/wsMock';
import { ElectrumRpcClient } from '../../src/modules/electrumRpcClient';
import { Network } from '../../src/types/electrum';

describe('ElectrumRpcClient', () => {
  beforeAll(() => installWebSocketMock());
  afterAll(() => restoreWebSocket());
  beforeEach(() => resetWebSocketMock());

  const cfg = { host: 'electrum.test', port: 50002, useTls: true, network: Network.Mainnet };

  it('connect() resolves on ws onopen and emits status=connected', async () => {
    const c = new ElectrumRpcClient(cfg);
    const events: string[] = [];
    c.onStatus.on(e => events.push(e.status));
    const promise = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await promise;
    expect(events).toContain('connected');
  });

  it('uses wss:// when useTls is true and the host:port from the config', async () => {
    const c = new ElectrumRpcClient(cfg);
    const promise = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await promise;
    expect(FakeWebSocket.lastInstance!.url).toBe('wss://electrum.test:50002');
  });

  it('uses ws:// when useTls is false', async () => {
    const c = new ElectrumRpcClient({ ...cfg, useTls: false });
    const promise = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await promise;
    expect(FakeWebSocket.lastInstance!.url).toBe('ws://electrum.test:50002');
  });

  it('sendRequest serializes JSON-RPC and resolves with the result', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const reqP = c.sendRequest('blockchain.headers.subscribe');
    const sent = JSON.parse(FakeWebSocket.lastInstance!.sent[0]);
    expect(sent.jsonrpc).toBe('2.0');
    expect(sent.method).toBe('blockchain.headers.subscribe');
    expect(typeof sent.id).toBe('number');
    FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ id: sent.id, result: { height: 800_000 } }));
    expect(await reqP).toEqual({ height: 800_000 });
  });

  it('sendRequest rejects when the server returns an error', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const reqP = c.sendRequest('bad.method');
    const sent = JSON.parse(FakeWebSocket.lastInstance!.sent[0]);
    FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ id: sent.id, error: { message: 'Method not found' } }));
    await expect(reqP).rejects.toThrow('Method not found');
  });

  it('sendBatchRequest fans out and resolves all in input order', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const p = c.sendBatchRequest('blockchain.scripthash.get_balance', [['hashA'], ['hashB']]);
    const batch = JSON.parse(FakeWebSocket.lastInstance!.sent[0]);
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(2);
    FakeWebSocket.lastInstance!.triggerMessage(
      JSON.stringify([
        { id: batch[1].id, result: { confirmed: 200 } },
        { id: batch[0].id, result: { confirmed: 100 } },
      ]),
    );
    const out = await p;
    expect(out).toEqual([{ confirmed: 100 }, { confirmed: 200 }]);
  });

  it('handles newline-delimited JSON frames containing multiple responses', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const a = c.sendRequest('m1');
    const b = c.sendRequest('m2');
    const ids = FakeWebSocket.lastInstance!.sent.map(s => JSON.parse(s).id);
    FakeWebSocket.lastInstance!.triggerMessage(
      JSON.stringify({ id: ids[0], result: 'A' }) + '\n' + JSON.stringify({ id: ids[1], result: 'B' }) + '\n',
    );
    expect(await a).toBe('A');
    expect(await b).toBe('B');
  });

  it('handles a single object frame without trailing newline', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const p = c.sendRequest('m');
    const id = JSON.parse(FakeWebSocket.lastInstance!.sent[0]).id;
    FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ id, result: 'ok' }));
    expect(await p).toBe('ok');
  });

  it('handles incomplete frames buffered across triggerMessage calls', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const p = c.sendRequest('m');
    const id = JSON.parse(FakeWebSocket.lastInstance!.sent[0]).id;
    const full = JSON.stringify({ id, result: 'late' }) + '\n';
    FakeWebSocket.lastInstance!.triggerMessage(full.slice(0, full.length - 5));
    FakeWebSocket.lastInstance!.triggerMessage(full.slice(full.length - 5));
    expect(await p).toBe('late');
  });

  it('disconnect rejects all pending requests', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const pending = c.sendRequest('any');
    c.disconnect();
    await expect(pending).rejects.toThrow('Websocket closed');
  });

  it('sendRequest throws when not connected', async () => {
    const c = new ElectrumRpcClient(cfg);
    await expect(c.sendRequest('x')).rejects.toThrow(/WebSocket is not open/);
  });

  it('socket error rejects connect() and emits status=error', async () => {
    const c = new ElectrumRpcClient(cfg);
    const errs: string[] = [];
    c.onStatus.on(e => errs.push(e.status));
    const p = c.connect();
    FakeWebSocket.lastInstance!.triggerError('boom');
    await expect(p).rejects.toBeDefined();
    expect(errs).toContain('error');
  });

  it('ignores non-RPC messages without a numeric id', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    FakeWebSocket.lastInstance!.triggerOpen();
    await cp;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ jsonrpc: '2.0', method: 'banner.update' })),
    ).not.toThrow();
    warnSpy.mockRestore();
  });
});
