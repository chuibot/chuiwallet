import { ELECTRUM_METHODS, HEALTH_CHECK_TIMEOUT_IN_MS, MAX_SERVERS_TO_RACE } from '../config/constants';
import type { ElectrumPeerResponse, ExtendedServerConfig, ServerConfig } from '../types/electrum';
import { Network } from '../types/electrum';
import { logger } from '../utils/logger';

export const availableServerList: ServerConfig[] = [
  // --- MAINNET (SSL + Browser-Safe Ports) ---
  { host: 'bitcoinserver.nl', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'btc.electroncash.dk', port: 60004, useTls: true, network: Network.Mainnet },
  { host: 'electrum.emzy.de', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'electrumx.network', port: 50002, useTls: true, network: Network.Mainnet },
  { host: 'bitcoin.lu.ke', port: 50002, useTls: true, network: Network.Mainnet },
  { host: 'electrum.data.casa', port: 443, useTls: true, network: Network.Mainnet },

  // --- TESTNET 4 (SSL + Browser-Safe Ports) ---
  { host: 'testnet4.electrs.btcscan.net', port: 443, useTls: true, network: Network.Testnet },
  { host: 'testnet4.inventory.mempool.space', port: 443, useTls: true, network: Network.Testnet },
  { host: 'tn4.mempool.space', port: 443, useTls: true, network: Network.Testnet },
];

/**
 * Checks if a server is alive and responding with Bitcoin data.
 * Returns latency and block height if successful.
 */
export async function simpleHealthCheck(server: ServerConfig): Promise<ExtendedServerConfig> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;
  const start = performance.now();

  return new Promise(resolve => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      resolve({ ...server, healthy: false, latency: 9999 });
    }, HEALTH_CHECK_TIMEOUT_IN_MS);

    socket.onopen = () => {
      // One call to verify the server is actually processing Bitcoin logic
      socket.send(JSON.stringify({ id: 1, method: ELECTRUM_METHODS.HEADERS_SUBSCRIBE, params: [] }));
    };

    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        const height = data.result?.block_height || data.result?.height;
        if (height) {
          clearTimeout(timeout);
          socket.close();
          resolve({
            ...server,
            healthy: true,
            latency: performance.now() - start,
            blockHeight: height,
          });
        }
      } catch {
        socket.close();
        resolve({ ...server, healthy: false, latency: 9999 });
      }
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      socket.close();
      resolve({ ...server, healthy: false, latency: 9999 });
    };
  });
}

export async function selectBestServer(network: Network): Promise<ExtendedServerConfig> {
  const hardcodedServers = availableServerList.filter(s => s.network === network);

  // Load discovered peers from storage
  const storageKey = `discoveredPeers_${network}`;
  const cached = await chrome.storage.local.get(storageKey);
  let discoveredPeers: ServerConfig[] = cached[storageKey] || [];
  // Shuffle discovered peers so we aren't always pinging the same failing ones
  discoveredPeers = discoveredPeers.sort(() => Math.random() - 0.5);

  const serversToScan = [
    ...hardcodedServers,
    ...discoveredPeers.slice(0, MAX_SERVERS_TO_RACE - hardcodedServers.length),
  ];

  // Race all servers simultaneously
  const results = await Promise.all(serversToScan.map(s => simpleHealthCheck(s)));

  console.table(
    results.map(r => ({
      host: r.host,
      healthy: r.healthy ? '✅' : '❌',
      latency: r.healthy ? `${Math.round(r.latency!)}ms` : 'TIMEOUT',
      height: r.blockHeight || 'N/A',
    })),
  );

  // Filter for healthy servers
  const healthyServers = results.filter(s => s.healthy);

  if (healthyServers.length === 0) {
    throw new Error(`No healthy servers found for ${network}`);
  }

  // Find the highest block height reported
  const maxHeight = Math.max(...healthyServers.map(s => s.blockHeight || 0));

  // Filter out "Zombies" (servers lagging more than 1 block behind)
  const syncedServers = healthyServers.filter(s => (s.blockHeight || 0) >= maxHeight - 1);

  // Sort synced servers by latency and pick the best one
  const bestServer = syncedServers.sort((a, b) => (a.latency || 9999) - (b.latency || 9999))[0];

  logger.log(`%c Best Server Picked: ${bestServer.host}`, 'color: #00ffa3; font-weight: bold;');
  return bestServer;
}

/**
 * Fetches new peers from the current connected server
 */
export async function discoverPeersFrom(server: ServerConfig): Promise<ServerConfig[]> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;

  return new Promise(resolve => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      resolve([]);
    }, 5000); // Slightly longer for this call

    socket.onopen = () => {
      socket.send(JSON.stringify({ id: 1, method: 'server.peers.subscribe', params: [] }));
    };

    socket.onmessage = event => {
      try {
        const response = JSON.parse(event.data);
        if (response.id === 1 && Array.isArray(response.result)) {
          const peers: ServerConfig[] = response.result
            .map((p: ElectrumPeerResponse) => {
              const host = p[1];
              const features = p[2] || [];

              const sslFeature = features.find((f: string) => f.startsWith('s'));
              if (!sslFeature) return null;

              const sslPort = parseInt(sslFeature.substring(1));

              // Strict browser-compatible filtering
              if (
                host &&
                sslPort &&
                !host.endsWith('.onion') && // No Tor
                !/^\d+\.\d+\.\d+\.\d+$/.test(host) && // No raw IPs (domain names only)
                !host.includes('localhost') &&
                host.length < 100 && // Sanity check
                isBrowserSafePort(sslPort) // Valid port
              ) {
                return {
                  host,
                  port: sslPort,
                  useTls: true,
                  network: server.network,
                };
              }
              return null;
            })
            .filter((p: ServerConfig | null): p is ServerConfig => p !== null);

          clearTimeout(timeout);
          socket.close();

          logger.log(`Filtered to ${peers.length} browser-compatible peers (from ${response.result.length} total)`);
          resolve(peers);
        }
      } catch (error) {
        logger.error('Error parsing peers:', error);
        socket.close();
        resolve([]);
      }
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      socket.close();
      resolve([]);
    };
  });
}

// Add this helper to electrumServer.ts
function isBrowserSafePort(port: number): boolean {
  return port === 443 || (port >= 50000 && port <= 50010) || (port >= 60000 && port <= 60010);
}
