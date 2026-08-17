import {
  CHECKPOINT_HEADERS,
  FakeWebSocket,
  installWebSocketMock,
  resetWebSocketMock,
  restoreWebSocket,
} from '../helpers/wsMock';
import { ElectrumRpcClient } from '../../src/modules/electrumRpcClient';
import { ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION } from '../../src/modules/electrumHandshake';
import { Network } from '../../src/types/electrum';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));

/** Last request written to the socket, skipping the connect handshake frames. */
const lastRequest = (sock: FakeWebSocket) => {
  const requests = sock.sentRequests();
  return requests[requests.length - 1];
};

describe('ElectrumRpcClient', () => {
  beforeAll(() => installWebSocketMock());
  afterAll(() => restoreWebSocket());
  beforeEach(() => resetWebSocketMock());

  const cfg = { host: 'electrum.test', port: 50002, useTls: true, network: Network.Mainnet };

  it('connect() resolves after the handshake and emits status=connected', async () => {
    const c = new ElectrumRpcClient(cfg);
    const events: string[] = [];
    c.onStatus.on(e => events.push(e.status));
    const promise = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await promise;
    expect(events).toContain('connected');
  });

  it('uses wss:// when useTls is true and the host:port from the config', async () => {
    const c = new ElectrumRpcClient(cfg);
    const promise = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await promise;
    expect(FakeWebSocket.lastInstance!.url).toBe('wss://electrum.test:50002');
  });

  it('uses ws:// when useTls is false', async () => {
    const c = new ElectrumRpcClient({ ...cfg, useTls: false });
    const promise = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await promise;
    expect(FakeWebSocket.lastInstance!.url).toBe('ws://electrum.test:50002');
  });

  it('sendRequest serializes JSON-RPC and resolves with the result', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const reqP = c.sendRequest('blockchain.headers.subscribe');
    const sent = lastRequest(FakeWebSocket.lastInstance!);
    expect(sent.jsonrpc).toBe('2.0');
    expect(sent.method).toBe('blockchain.headers.subscribe');
    expect(typeof sent.id).toBe('number');
    FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ id: sent.id, result: { height: 800_000 } }));
    expect(await reqP).toEqual({ height: 800_000 });
  });

  it('sendRequest rejects when the server returns an error', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const reqP = c.sendRequest('bad.method');
    const sent = lastRequest(FakeWebSocket.lastInstance!);
    FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ id: sent.id, error: { message: 'Method not found' } }));
    await expect(reqP).rejects.toThrow('Method not found');
  });

  it('sendBatchRequest fans out and resolves all in input order', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const p = c.sendBatchRequest('blockchain.scripthash.get_balance', [['hashA'], ['hashB']]);
    const batch = JSON.parse(FakeWebSocket.lastInstance!.sent[FakeWebSocket.lastInstance!.sent.length - 1]);
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
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const a = c.sendRequest('m1');
    const b = c.sendRequest('m2');
    const ids = FakeWebSocket.lastInstance!.sentRequests()
      .filter(r => r.method === 'm1' || r.method === 'm2')
      .map(r => r.id);
    FakeWebSocket.lastInstance!.triggerMessage(
      JSON.stringify({ id: ids[0], result: 'A' }) + '\n' + JSON.stringify({ id: ids[1], result: 'B' }) + '\n',
    );
    expect(await a).toBe('A');
    expect(await b).toBe('B');
  });

  it('handles a single object frame without trailing newline', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const p = c.sendRequest('m');
    const id = lastRequest(FakeWebSocket.lastInstance!).id;
    FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ id, result: 'ok' }));
    expect(await p).toBe('ok');
  });

  it('handles incomplete frames buffered across triggerMessage calls', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const p = c.sendRequest('m');
    const id = lastRequest(FakeWebSocket.lastInstance!).id;
    const full = JSON.stringify({ id, result: 'late' }) + '\n';
    FakeWebSocket.lastInstance!.triggerMessage(full.slice(0, full.length - 5));
    FakeWebSocket.lastInstance!.triggerMessage(full.slice(full.length - 5));
    expect(await p).toBe('late');
  });

  it('disconnect rejects all pending requests', async () => {
    const c = new ElectrumRpcClient(cfg);
    const cp = c.connect();
    await FakeWebSocket.lastInstance!.openAndHandshake();
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
    await FakeWebSocket.lastInstance!.openAndHandshake();
    await cp;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      FakeWebSocket.lastInstance!.triggerMessage(JSON.stringify({ jsonrpc: '2.0', method: 'banner.update' })),
    ).not.toThrow();
    warnSpy.mockRestore();
  });

  it('disconnect before onopen rejects the pending connect promise', async () => {
    const c = new ElectrumRpcClient(cfg);
    const p = c.connect();
    const sock = FakeWebSocket.lastInstance!;
    c.disconnect();
    sock.triggerClose();
    await expect(p).rejects.toThrow(/closed before connection opened/);
  });

  it('stale socket open does not resolve the current connection', async () => {
    const c = new ElectrumRpcClient(cfg);

    const stale = c.connect();
    const staleSocket = FakeWebSocket.lastInstance!;

    const current = c.connect();
    const currentSocket = FakeWebSocket.lastInstance!;
    expect(currentSocket).not.toBe(staleSocket);

    staleSocket.triggerOpen();
    await expect(stale).rejects.toThrow(/replaced before opening/);

    await currentSocket.openAndHandshake();
    await expect(current).resolves.toBe(c);
  });

  describe('connect handshake', () => {
    it('negotiates server.version before anything else', async () => {
      const c = new ElectrumRpcClient(cfg);
      const promise = c.connect();
      const sock = FakeWebSocket.lastInstance!;
      await sock.openAndHandshake();
      await promise;

      const first = sock.sentRequests()[0];
      expect(first.method).toBe('server.version');
      expect(first.params).toEqual([ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION]);
    });

    // A server can accept the socket and answer server.version while never serving block data.
    it('does not report connected until the server has served real block data', async () => {
      const c = new ElectrumRpcClient(cfg);
      const events: string[] = [];
      c.onStatus.on(e => events.push(e.status));

      const promise = c.connect();
      const sock = FakeWebSocket.lastInstance!;
      sock.triggerOpen();
      await tick();
      expect(events).not.toContain('connected');

      await sock.answerHandshake();
      await promise;
      expect(events).toContain('connected');
    });

    it('rejects a server serving a different chain at the checkpoint height', async () => {
      const c = new ElectrumRpcClient(cfg);
      const promise = c.connect();
      const sock = FakeWebSocket.lastInstance!;
      await sock.openAndHandshake({ header: CHECKPOINT_HEADERS[Network.Testnet] });

      await expect(promise).rejects.toThrow(/chain/i);
    });

    it('rejects when the server errors on the version request', async () => {
      const c = new ElectrumRpcClient(cfg);
      const promise = c.connect();
      const sock = FakeWebSocket.lastInstance!;
      await sock.openAndHandshake({ versionError: { message: 'unsupported protocol' } });

      await expect(promise).rejects.toThrow(/unsupported protocol/);
    });

    it('rejects when the socket opens but the server never answers', async () => {
      jest.useFakeTimers();
      try {
        const c = new ElectrumRpcClient(cfg);
        const promise = c.connect();
        const rejects = expect(promise).rejects.toThrow(/timed out/);
        FakeWebSocket.lastInstance!.triggerOpen();
        await jest.advanceTimersByTimeAsync(ElectrumRpcClient.CONNECT_TIMEOUT_MS + 10);
        await rejects;
      } finally {
        jest.useRealTimers();
      }
    });

    it('settles when the socket closes mid-handshake', async () => {
      const c = new ElectrumRpcClient(cfg);
      const promise = c.connect();
      const sock = FakeWebSocket.lastInstance!;
      sock.triggerOpen();
      await tick();
      sock.triggerClose();

      await expect(promise).rejects.toBeDefined();
    });
  });

  describe('request timeouts', () => {
    it('rejects a request the server never answers and drops the connection', async () => {
      jest.useFakeTimers();
      try {
        const c = new ElectrumRpcClient(cfg);
        const connecting = c.connect();
        const sock = FakeWebSocket.lastInstance!;
        sock.triggerOpen();
        await jest.advanceTimersByTimeAsync(5);
        await sock.answerHandshake();
        await connecting;

        const statuses: string[] = [];
        c.onStatus.on(e => statuses.push(e.status));
        const pending = c.sendRequest('blockchain.scripthash.get_history', ['deadbeef']);
        const rejects = expect(pending).rejects.toThrow(/timed out/);
        await jest.advanceTimersByTimeAsync(ElectrumRpcClient.REQUEST_TIMEOUT_MS + 10);
        await rejects;

        expect(statuses).toContain('disconnected');
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects every leg of a batch that goes unanswered', async () => {
      jest.useFakeTimers();
      try {
        const c = new ElectrumRpcClient(cfg);
        const connecting = c.connect();
        const sock = FakeWebSocket.lastInstance!;
        sock.triggerOpen();
        await jest.advanceTimersByTimeAsync(5);
        await sock.answerHandshake();
        await connecting;

        const pending = c.sendBatchRequest('blockchain.scripthash.listunspent', [['a'], ['b'], ['c']]);
        const rejects = expect(pending).rejects.toThrow(/timed out/);
        await jest.advanceTimersByTimeAsync(60_000);
        await rejects;
      } finally {
        jest.useRealTimers();
      }
    });

    // A broadcast may have reached the mempool before the reply timed out; tearing the
    // connection down and retrying risks a second, conflicting transaction.
    it('keeps the connection when a broadcast times out', async () => {
      jest.useFakeTimers();
      try {
        const c = new ElectrumRpcClient(cfg);
        const connecting = c.connect();
        const sock = FakeWebSocket.lastInstance!;
        sock.triggerOpen();
        await jest.advanceTimersByTimeAsync(5);
        await sock.answerHandshake();
        await connecting;

        const statuses: string[] = [];
        c.onStatus.on(e => statuses.push(e.status));
        const pending = c.sendRequest('blockchain.transaction.broadcast', ['00'], { disconnectOnTimeout: false });
        const rejects = expect(pending).rejects.toThrow(/timed out/);
        await jest.advanceTimersByTimeAsync(60_000);
        await rejects;

        expect(statuses).not.toContain('disconnected');
      } finally {
        jest.useRealTimers();
      }
    });

    // A timer left running past disconnect would later tear down whichever healthy
    // connection had replaced it.
    it('cancels a pending request timer when the connection is torn down', async () => {
      jest.useFakeTimers();
      try {
        const c = new ElectrumRpcClient(cfg);
        const connecting = c.connect();
        const sock = FakeWebSocket.lastInstance!;
        sock.triggerOpen();
        await jest.advanceTimersByTimeAsync(5);
        await sock.answerHandshake();
        await connecting;

        const pending = c.sendRequest('slow.method');
        const rejects = expect(pending).rejects.toThrow(/Websocket closed/);
        c.disconnect();
        await rejects;

        const reconnecting = c.connect();
        const fresh = FakeWebSocket.lastInstance!;
        fresh.triggerOpen();
        await fresh.answerHandshake();
        await reconnecting;

        const statuses: string[] = [];
        c.onStatus.on(e => statuses.push(e.status));
        await jest.advanceTimersByTimeAsync(120_000);
        expect(statuses).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
