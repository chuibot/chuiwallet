import { availableServerList, scanServers, selectBestServer } from '../../src/modules/electrumServer';
import { Network } from '../../src/types/electrum';
import { FakeWebSocket, installWebSocketMock, resetWebSocketMock, restoreWebSocket } from '../helpers/wsMock';

describe('availableServerList', () => {
  it('contains both mainnet and testnet entries', () => {
    expect(availableServerList.some(s => s.network === Network.Mainnet)).toBe(true);
    expect(availableServerList.some(s => s.network === Network.Testnet)).toBe(true);
  });

  it('every entry uses TLS', () => {
    expect(availableServerList.every(s => s.useTls === true)).toBe(true);
  });
});

describe('selectBestServer + scanServers (with WebSocket mock)', () => {
  beforeAll(() => installWebSocketMock());
  afterAll(() => restoreWebSocket());
  beforeEach(() => resetWebSocketMock());

  it('throws when no servers exist for the network', async () => {
    await expect(selectBestServer('zzz' as unknown as Network)).rejects.toThrow(/No servers available/);
  });

  it('picks the lowest-latency healthy server', async () => {
    const servers = [
      { host: 'slow.test', port: 50002, useTls: true, network: Network.Mainnet },
      { host: 'fast.test', port: 50002, useTls: true, network: Network.Mainnet },
    ];
    const promise = scanServers(servers);
    setTimeout(() => {
      const slow = FakeWebSocket.instances.find(i => i.url.includes('slow'));
      const fast = FakeWebSocket.instances.find(i => i.url.includes('fast'));
      fast?.triggerOpen();
      fast?.triggerMessage(JSON.stringify({ id: 1, result: 'ok' }));
      slow?.triggerOpen();
      setTimeout(() => slow?.triggerMessage(JSON.stringify({ id: 1, result: 'ok' })), 30);
    }, 5);
    const out = await promise;
    expect(out.every(s => s.healthy)).toBe(true);
    const fast = out.find(s => s.host === 'fast.test');
    const slow = out.find(s => s.host === 'slow.test');
    expect(fast!.latency!).toBeLessThanOrEqual(slow!.latency!);
  });

  it('marks unreachable servers as unhealthy (latency = MAX_SAFE_INTEGER)', async () => {
    const servers = [{ host: 'down.test', port: 50002, useTls: true, network: Network.Mainnet }];
    const promise = scanServers(servers);
    setTimeout(() => {
      FakeWebSocket.instances[0]?.triggerError('refused');
    }, 5);
    const out = await promise;
    expect(out[0].healthy).toBe(false);
    expect(out[0].latency).toBe(Number.MAX_SAFE_INTEGER);
  });
});
