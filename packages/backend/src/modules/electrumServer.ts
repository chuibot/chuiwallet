import type { ExtendedServerConfig, ServerConfig } from '../types/electrum';
import { DefaultPort, Network } from '../types/electrum';

export const availableServerList: ServerConfig[] = [
  { host: 'bitcoinserver.nl', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'btc.electroncash.dk', port: 60004, useTls: true, network: Network.Mainnet },
  { host: 'node.xbt.eu', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'us11.einfachmalnettsein.de', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'b.1209k.com', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'testnet4.electrs.btcscan.net', port: 443, useTls: true, network: Network.Testnet },
  { host: 'testnet4.electrum.blockonomics.co', port: 443, useTls: true, network: Network.Testnet },
];

function median(vals: number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export async function queryTipHeight(server: ExtendedServerConfig, timeout = 5000): Promise<number> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Tip height query timed out: ${server.host}`));
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
        const result = parsed.result as { height?: unknown } | null | undefined;
        if (result != null && typeof result.height === 'number' && result.height > 0) {
          resolve(result.height);
        } else {
          resolve(0);
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
      reject(new Error(`WebSocket error querying tip: ${server.host}`));
    };

    socket.onclose = () => {
      clearTimeout(timer);
    };
  });
}

export async function getConsensusTipHeight(servers: ExtendedServerConfig[]): Promise<number> {
  if (servers.length === 0) return 0;
  const results = await Promise.allSettled(servers.map(s => queryTipHeight(s)));
  const heights = results
    .filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled' && r.value > 0)
    .map(r => r.value);
  if (heights.length === 0) return 0;
  const med = median(heights);
  const outliers = heights.filter(h => Math.abs(h - med) > 6);
  if (outliers.length > 0) {
    throw new Error(`Tip height consensus failed: ${outliers.length} server(s) deviate >6 blocks from median ${med}`);
  }
  return med;
}

export async function selectBestServer(
  network: Network,
): Promise<{ server: ExtendedServerConfig; healthyServers: ExtendedServerConfig[] }> {
  const serverList = availableServerList.filter(server => server.network === network);
  if (serverList.length === 0) {
    throw new Error(`No servers available for ${network}`);
  }

  const scannedServers = await scanServers(serverList);
  const healthyServers = scannedServers.filter(server => server.healthy);
  if (healthyServers.length === 0) {
    throw new Error('No healthy servers found');
  }

  healthyServers.sort((a, b) => a.latency! - b.latency!);
  return { server: healthyServers[0], healthyServers };
}

export async function scanServers(servers: ExtendedServerConfig[]): Promise<ExtendedServerConfig[]> {
  return await Promise.all(
    servers.map(async server => {
      const latency = await measureServerLatency(server);
      return { ...server, latency, healthy: latency < 5000 }; // healthy if latency is less than 5 seconds
    }),
  );
}

export async function measureServerLatency(server: ExtendedServerConfig): Promise<number> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;
  return new Promise<number>(resolve => {
    const socket = new WebSocket(url);
    const start = performance.now();
    // Use a timeout to consider the server unresponsive if it takes too long.
    const timeout = setTimeout(() => {
      socket.close();
      resolve(Number.MAX_SAFE_INTEGER);
    }, 5000); // 5 seconds

    socket.onopen = () => {
      // Optionally send a lightweight RPC call like server.version here.
      socket.send(JSON.stringify({ id: 1, method: 'server.version', params: [] }));
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    socket.onmessage = (event: MessageEvent) => {
      clearTimeout(timeout);
      const end = performance.now();
      socket.close();
      resolve(end - start);
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      socket.close();
      resolve(Number.MAX_SAFE_INTEGER);
    };
  });
}
