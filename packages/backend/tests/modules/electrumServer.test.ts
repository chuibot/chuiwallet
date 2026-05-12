import {
  availableServerList,
  getConsensusTip,
  queryTipHeader,
  scanServers,
  selectBestServer,
} from '../../src/modules/electrumServer';
import { Network } from '../../src/types/electrum';
import { FakeWebSocket, installWebSocketMock, resetWebSocketMock, restoreWebSocket } from '../helpers/wsMock';

const mkServer = (host: string) => ({ host, port: 50002, useTls: true, network: Network.Mainnet });
const FAKE_HEX = '00'.repeat(80); // 160-char header hex; merkle_root bytes 36-67 = '00'.repeat(32)
const FAKE_MERKLE_ROOT = '00'.repeat(32);

const respond = (ws: FakeWebSocket, height: number | null, hex = FAKE_HEX) => {
  ws.triggerOpen();
  ws.triggerMessage(JSON.stringify({ id: 1, result: height === null ? null : { height, hex } }));
};

describe('availableServerList', () => {
  it('contains both mainnet and testnet entries', () => {
    expect(availableServerList.some(s => s.network === Network.Mainnet)).toBe(true);
    expect(availableServerList.some(s => s.network === Network.Testnet)).toBe(true);
  });

  it('every entry uses TLS', () => {
    expect(availableServerList.every(s => s.useTls === true)).toBe(true);
  });
});

describe('WebSocket-backed server functions', () => {
  beforeAll(() => installWebSocketMock());
  afterAll(() => restoreWebSocket());
  beforeEach(() => resetWebSocketMock());

  describe('selectBestServer + scanServers', () => {
    it('throws when no servers exist for the network', async () => {
      await expect(selectBestServer('zzz' as unknown as Network)).rejects.toThrow(/No servers available/);
    });

    it('picks the lowest-latency healthy server', async () => {
      const servers = [mkServer('slow.test'), mkServer('fast.test')];
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
      expect(out.find(s => s.host === 'fast.test')!.latency!).toBeLessThanOrEqual(
        out.find(s => s.host === 'slow.test')!.latency!,
      );
    });

    it('marks unreachable servers as unhealthy', async () => {
      const promise = scanServers([mkServer('down.test')]);
      setTimeout(() => FakeWebSocket.instances[0]?.triggerError('refused'), 5);
      const out = await promise;
      expect(out[0].healthy).toBe(false);
      expect(out[0].latency).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('queryTipHeader', () => {
    it('resolves with height and hex from server', async () => {
      const promise = queryTipHeader(mkServer('tip.test'));
      setTimeout(() => respond(FakeWebSocket.instances[0]!, 850_000), 5);
      expect(await promise).toEqual({ height: 850_000, hex: FAKE_HEX });
    });

    it('resolves with null on null result', async () => {
      const promise = queryTipHeader(mkServer('tip.test'));
      setTimeout(() => respond(FakeWebSocket.instances[0]!, null), 5);
      expect(await promise).toBeNull();
    });

    it('resolves with null when hex is missing', async () => {
      const promise = queryTipHeader(mkServer('tip.test'));
      setTimeout(() => {
        const ws = FakeWebSocket.instances[0]!;
        ws.triggerOpen();
        ws.triggerMessage(JSON.stringify({ id: 1, result: { height: 850_000 } }));
      }, 5);
      expect(await promise).toBeNull();
    });

    it('rejects on WebSocket error', async () => {
      const promise = queryTipHeader(mkServer('tip.test'));
      setTimeout(() => FakeWebSocket.instances[0]?.triggerError('refused'), 5);
      await expect(promise).rejects.toThrow(/WebSocket error querying tip/);
    });

    it('ignores messages with non-matching id', async () => {
      const promise = queryTipHeader(mkServer('tip.test'));
      setTimeout(() => {
        const ws = FakeWebSocket.instances[0]!;
        ws.triggerOpen();
        ws.triggerMessage(JSON.stringify({ id: 2, result: { height: 999_999, hex: FAKE_HEX } }));
        ws.triggerMessage(JSON.stringify({ id: 1, result: { height: 850_000, hex: FAKE_HEX } }));
      }, 5);
      expect(await promise).toEqual({ height: 850_000, hex: FAKE_HEX });
    });
  });

  describe('getConsensusTip', () => {
    it('throws for empty server list (quorum not met)', async () => {
      await expect(getConsensusTip([])).rejects.toThrow(/Insufficient server responses/);
    });

    it('returns median height and merkle_root when servers agree', async () => {
      const promise = getConsensusTip(['a', 'b', 'c'].map(mkServer));
      setTimeout(() => {
        [850_000, 850_001, 850_000].forEach((h, i) => respond(FakeWebSocket.instances[i]!, h));
      }, 5);
      const tip = await promise;
      expect(tip.height).toBe(850_000);
      expect(tip.merkle_root).toBe(FAKE_MERKLE_ROOT);
    });

    it('throws when fewer than 2 servers respond (quorum not met)', async () => {
      const promise = getConsensusTip(['a', 'b'].map(mkServer));
      setTimeout(() => FakeWebSocket.instances.forEach(ws => ws.triggerError('refused')), 5);
      await expect(promise).rejects.toThrow(/Insufficient server responses/);
    });

    it('throws when only 1 of 3 servers responds', async () => {
      const promise = getConsensusTip(['a', 'b', 'c'].map(mkServer));
      setTimeout(() => {
        respond(FakeWebSocket.instances[0]!, 850_000);
        FakeWebSocket.instances[1]?.triggerError('refused');
        FakeWebSocket.instances[2]?.triggerError('refused');
      }, 5);
      await expect(promise).rejects.toThrow(/Insufficient server responses/);
    });

    it('throws when a server deviates more than 6 blocks from median', async () => {
      const promise = getConsensusTip(['a', 'b', 'c'].map(mkServer));
      setTimeout(() => {
        [850_000, 850_000, 850_100].forEach((h, i) => respond(FakeWebSocket.instances[i]!, h));
      }, 5);
      await expect(promise).rejects.toThrow(/consensus failed/);
    });

    it('accepts servers within the Δ6 tolerance', async () => {
      const promise = getConsensusTip(['a', 'b'].map(mkServer));
      setTimeout(() => {
        [850_000, 850_006].forEach((h, i) => respond(FakeWebSocket.instances[i]!, h));
      }, 5);
      const tip = await promise;
      expect(tip.height).toBe(850_003);
      expect(tip.merkle_root).toBe(FAKE_MERKLE_ROOT);
    });
  });
});
