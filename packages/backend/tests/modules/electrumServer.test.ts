import {
  availableServerList,
  getConsensusTip,
  pickServer,
  queryTipHeader,
  scanServers,
  selectBestServer,
} from '../../src/modules/electrumServer';
import { ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION } from '../../src/modules/electrumHandshake';
import { Network } from '../../src/types/electrum';
import { FakeWebSocket, installWebSocketMock, resetWebSocketMock, restoreWebSocket } from '../helpers/wsMock';
import { resetChromeStorage } from '../helpers/chromeMock';

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

  // Failover needs somewhere to fail over to.
  it('offers enough mainnet servers to rotate through', () => {
    expect(availableServerList.filter(s => s.network === Network.Mainnet).length).toBeGreaterThanOrEqual(3);
  });

  it('lists each operator once, so a rotation cannot land on the same machine twice', () => {
    const mainnetHosts = availableServerList.filter(s => s.network === Network.Mainnet).map(s => s.host);
    expect(new Set(mainnetHosts).size).toBe(mainnetHosts.length);
  });
});

describe('pickServer', () => {
  const ranked = ['a', 'b', 'c', 'd', 'e'].map((host, i) => ({ ...mkServer(host), latency: i, healthy: true }));

  // Always dialling the single fastest server hands one operator the wallet's whole
  // address graph, session after session.
  it('picks from the fastest few rather than always the same server', () => {
    const picked = new Set(Array.from({ length: 60 }, () => pickServer(ranked).host));
    expect(picked.size).toBeGreaterThan(1);
    expect([...picked].every(host => ['a', 'b', 'c'].includes(host))).toBe(true);
  });

  it('handles a pool smaller than the spread', () => {
    expect(['a', 'b']).toContain(pickServer(ranked.slice(0, 2)).host);
    expect(pickServer(ranked.slice(0, 1)).host).toBe('a');
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

    it('probes with a real server.version request', async () => {
      const promise = scanServers([mkServer('probe.test')]);
      setTimeout(() => {
        const ws = FakeWebSocket.instances[0]!;
        ws.triggerOpen();
        ws.triggerMessage(JSON.stringify({ id: 1, result: ['Fulcrum 2.1.1', '1.4'] }));
      }, 5);
      await promise;
      const probe = JSON.parse(FakeWebSocket.instances[0]!.sent[0]);
      expect(probe.method).toBe('server.version');
      expect(probe.params).toEqual([ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION]);
    });

    it('does not count an unrelated frame as a healthy reply', async () => {
      const promise = scanServers([mkServer('chatty.test')]);
      setTimeout(() => {
        const ws = FakeWebSocket.instances[0]!;
        ws.triggerOpen();
        ws.triggerMessage(JSON.stringify({ jsonrpc: '2.0', method: 'blockchain.headers.subscribe', params: [{}] }));
        ws.triggerMessage(JSON.stringify({ id: 99, result: 'not our probe' }));
      }, 5);
      const out = await promise;
      expect(out[0].healthy).toBe(false);
    });

    it('marks a server that rejects the probe as unhealthy', async () => {
      const promise = scanServers([mkServer('grumpy.test')]);
      setTimeout(() => {
        const ws = FakeWebSocket.instances[0]!;
        ws.triggerOpen();
        ws.triggerMessage(JSON.stringify({ id: 1, error: { message: 'unsupported client' } }));
      }, 5);
      const out = await promise;
      expect(out[0].healthy).toBe(false);
      expect(out[0].latency).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('server selection cache', () => {
    beforeEach(() => resetChromeStorage());

    const answerProbes = async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      for (const inst of [...FakeWebSocket.instances]) {
        inst.triggerOpen();
        inst.triggerMessage(JSON.stringify({ id: 1, result: ['Fulcrum', '1.4'] }));
      }
    };

    it('reuses a recent scan instead of re-probing every server', async () => {
      const first = selectBestServer(Network.Mainnet);
      await answerProbes();
      await first;
      const probedOnce = FakeWebSocket.instances.length;

      const second = await selectBestServer(Network.Mainnet);

      expect(FakeWebSocket.instances.length).toBe(probedOnce);
      expect(second.healthyServers.length).toBeGreaterThan(0);
    });

    it('re-probes when the caller forces a refresh', async () => {
      const first = selectBestServer(Network.Mainnet);
      await answerProbes();
      await first;
      const probedOnce = FakeWebSocket.instances.length;

      const refreshed = selectBestServer(Network.Mainnet, { refresh: true });
      await answerProbes();
      await refreshed;

      expect(FakeWebSocket.instances.length).toBeGreaterThan(probedOnce);
    });

    it('does not serve one network a cache built for the other', async () => {
      const first = selectBestServer(Network.Mainnet);
      await answerProbes();
      await first;
      const probedOnce = FakeWebSocket.instances.length;

      const testnet = selectBestServer(Network.Testnet);
      await answerProbes();
      const { healthyServers } = await testnet;

      expect(FakeWebSocket.instances.length).toBeGreaterThan(probedOnce);
      expect(healthyServers.every(s => s.network === Network.Testnet)).toBe(true);
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

    it('throws when two servers at the same height disagree on the header (forged merkle root)', async () => {
      const FORGED_HEX = 'ff'.repeat(80);
      const promise = getConsensusTip(['a', 'b', 'c'].map(mkServer));
      setTimeout(() => {
        // a and b report the same height but different header bytes
        respond(FakeWebSocket.instances[0]!, 850_000, FAKE_HEX);
        respond(FakeWebSocket.instances[1]!, 850_000, FORGED_HEX);
        respond(FakeWebSocket.instances[2]!, 850_001, FAKE_HEX);
      }, 5);
      await expect(promise).rejects.toThrow(/Merkle root consensus failed/);
    });
  });
});
