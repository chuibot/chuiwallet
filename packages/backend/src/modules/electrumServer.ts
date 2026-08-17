import browser from 'webextension-polyfill';
import type { ExtendedServerConfig, ServerConfig, TipHeader } from '../types/electrum';
import { Network } from '../types/electrum';
import { parseMerkleRoot } from '../utils/merkle';
import { ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION } from './electrumHandshake';

/**
 * Public WebSocket-capable Electrum peers, one per operator. Ports are not interchangeable:
 * several operators serve Bitcoin Cash on 50004 and Bitcoin on another port, so an entry is
 * only valid once its checkpoint block has been verified (see CHAIN_CHECKPOINTS).
 */
export const availableServerList: ServerConfig[] = [
  { host: 'btc.electroncash.dk', port: 60004, useTls: true, network: Network.Mainnet },
  { host: '0xrpc.io', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'bitcoin.grey.pw', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'e.keff.org', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'mempool.8333.mobi', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'testnet4.electrs.btcscan.net', port: 443, useTls: true, network: Network.Testnet },
  { host: 'testnet4.electrum.blockonomics.co', port: 443, useTls: true, network: Network.Testnet },
];

/** How many of the fastest servers are candidates for selection. */
const SELECTION_SPREAD = 3;

// The MV3 worker restarts every few minutes; without this every restart re-probes the whole
// list, which is both slow and a lot of connections to third-party operators.
const scanCacheKey = (network: Network) => `electrumScanCache:${network}`;
const SCAN_CACHE_TTL_MS = 10 * 60_000;

function median(vals: number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

type RawTipHeader = { height: number; hex: string };

export async function queryTipHeader(server: ExtendedServerConfig, timeout = 5000): Promise<RawTipHeader | null> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;
  return new Promise<RawTipHeader | null>((resolve, reject) => {
    const socket = new WebSocket(url);
    let buffer = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    const timer = setTimeout(() => {
      socket.close();
      settle(() => reject(new Error(`Tip height query timed out: ${server.host}`)));
    }, timeout);

    // Returns 'done' (resolved), 'skip' (valid JSON but not our id), 'incomplete' (partial JSON).
    const tryParse = (text: string): 'done' | 'skip' | 'incomplete' => {
      const trimmed = text.trim();
      if (!trimmed) return 'incomplete';
      try {
        const parsed = JSON.parse(trimmed) as { id?: unknown; result?: unknown };
        if (parsed.id !== 1) return 'skip';
        clearTimeout(timer);
        socket.close();
        const result = parsed.result as { height?: unknown; hex?: unknown } | null | undefined;
        if (
          result != null &&
          typeof result.height === 'number' &&
          result.height > 0 &&
          typeof result.hex === 'string'
        ) {
          settle(() => resolve({ height: result.height as number, hex: result.hex as string }));
        } else {
          settle(() => resolve(null));
        }
        return 'done';
      } catch {
        // incomplete JSON, keep buffering
      }
      return 'incomplete';
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'blockchain.headers.subscribe', params: [] }));
    };

    socket.onmessage = (event: MessageEvent) => {
      buffer += typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const r = tryParse(line);
        if (r === 'done') return;
      }
      const r = tryParse(buffer);
      if (r === 'done' || r === 'skip') buffer = '';
    };

    socket.onerror = () => {
      clearTimeout(timer);
      socket.close();
      settle(() => reject(new Error(`WebSocket error querying tip: ${server.host}`)));
    };

    socket.onclose = () => {
      clearTimeout(timer);
      settle(() => reject(new Error(`WebSocket closed before response: ${server.host}`)));
    };
  });
}

export async function getConsensusTip(servers: ExtendedServerConfig[]): Promise<TipHeader> {
  const results = await Promise.allSettled(servers.map(s => queryTipHeader(s)));
  const headers = results
    .filter((r): r is PromiseFulfilledResult<RawTipHeader> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
  if (headers.length < 2) {
    throw new Error(`Insufficient server responses for consensus (got ${headers.length}, need ≥2)`);
  }
  const heights = headers.map(h => h.height);
  const med = median(heights);
  const outliers = heights.filter(h => Math.abs(h - med) > 6);
  if (outliers.length > 0) {
    throw new Error(`Tip height consensus failed: ${outliers.length} server(s) deviate >6 blocks from median ${med}`);
  }

  // Cross-validate merkle roots: group by exact height, require ≥2 servers at the same
  // height to agree on the header bytes before trusting the root.
  const byHeight = new Map<number, RawTipHeader[]>();
  for (const h of headers) {
    const list = byHeight.get(h.height) ?? [];
    list.push(h);
    byHeight.set(h.height, list);
  }

  const groupsWithQuorum = [...byHeight.entries()]
    .filter(([, g]) => g.length >= 2)
    .sort((a, b) => Math.abs(a[0] - med) - Math.abs(b[0] - med));

  if (groupsWithQuorum.length > 0) {
    const [heightKey, group] = groupsWithQuorum[0];
    const roots = new Set(group.map(h => parseMerkleRoot(h.hex)));
    if (roots.size > 1) {
      throw new Error(`Merkle root consensus failed at height ${heightKey}: servers disagree on header content`);
    }
    return { height: med, merkle_root: parseMerkleRoot(group[0].hex) };
  }

  // No height has ≥2 servers — fall back to the server closest to median (no root cross-validation).
  const trustworthy = headers.reduce((best, curr) =>
    Math.abs(curr.height - med) < Math.abs(best.height - med) ? curr : best,
  );
  return { height: med, merkle_root: parseMerkleRoot(trustworthy.hex) };
}

/**
 * Choose among the fastest few rather than always the single fastest: a deterministic pick is
 * effectively the nearest server every session, handing one operator the wallet's full
 * address graph over time.
 */
export function pickServer(rankedServers: ExtendedServerConfig[]): ExtendedServerConfig {
  const candidates = rankedServers.slice(0, SELECTION_SPREAD);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

type ServerScanCache = { servers: ExtendedServerConfig[]; ts: number };

async function readScanCache(network: Network): Promise<ExtendedServerConfig[] | null> {
  const key = scanCacheKey(network);
  try {
    const stored = await browser.storage.session.get([key]);
    const cached = stored[key] as ServerScanCache | undefined;
    if (!cached || Date.now() - cached.ts > SCAN_CACHE_TTL_MS) return null;
    return cached.servers?.length ? cached.servers : null;
  } catch {
    return null;
  }
}

async function writeScanCache(network: Network, servers: ExtendedServerConfig[]): Promise<void> {
  try {
    await browser.storage.session.set({
      [scanCacheKey(network)]: { servers, ts: Date.now() } satisfies ServerScanCache,
    });
  } catch {
    // A cache miss only costs an extra scan.
  }
}

/**
 * @param refresh Skip the cache. Callers rotating through a failing pool must pass this, or the
 *   rescan would replay the same stale list that just failed.
 */
export async function selectBestServer(
  network: Network,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<{ server: ExtendedServerConfig; healthyServers: ExtendedServerConfig[] }> {
  const serverList = availableServerList.filter(server => server.network === network);
  if (serverList.length === 0) {
    throw new Error(`No servers available for ${network}`);
  }

  const cached = refresh ? null : await readScanCache(network);
  const healthyServers = cached ?? (await scanServers(serverList)).filter(server => server.healthy);
  if (healthyServers.length === 0) {
    throw new Error('No healthy servers found');
  }

  healthyServers.sort((a, b) => a.latency! - b.latency!);
  if (!cached) await writeScanCache(network, healthyServers);
  return { server: pickServer(healthyServers), healthyServers };
}

export async function scanServers(servers: ExtendedServerConfig[]): Promise<ExtendedServerConfig[]> {
  return await Promise.all(
    servers.map(async server => {
      const latency = await measureServerLatency(server);
      return { ...server, latency, healthy: latency < 5000 }; // healthy if latency is less than 5 seconds
    }),
  );
}

const PROBE_ID = 1;

export async function measureServerLatency(server: ExtendedServerConfig): Promise<number> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;
  return new Promise<number>(resolve => {
    const socket = new WebSocket(url);
    const start = performance.now();
    let buffer = '';
    // Use a timeout to consider the server unresponsive if it takes too long.
    const timeout = setTimeout(() => {
      socket.close();
      resolve(Number.MAX_SAFE_INTEGER);
    }, 5000); // 5 seconds

    const settle = (latency: number) => {
      clearTimeout(timeout);
      socket.close();
      resolve(latency);
    };

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: PROBE_ID,
          method: 'server.version',
          params: [ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION],
        }),
      );
    };

    // Only a JSON-RPC answer to our own probe counts, so a server that merely pushes
    // notifications cannot pass as healthy.
    socket.onmessage = (event: MessageEvent) => {
      buffer += typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      for (const frame of buffer.split('\n')) {
        const trimmed = frame.trim();
        if (!trimmed) continue;
        let parsed: { id?: unknown; result?: unknown; error?: unknown };
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // incomplete frame, keep buffering
        }
        if (parsed.id !== PROBE_ID) continue;
        settle(parsed.error || parsed.result === undefined ? Number.MAX_SAFE_INTEGER : performance.now() - start);
        return;
      }
    };

    socket.onerror = () => settle(Number.MAX_SAFE_INTEGER);
    // A server that opens then closes without answering would otherwise hold the whole
    // scan open for the full timeout.
    socket.onclose = () => settle(Number.MAX_SAFE_INTEGER);
  });
}
