import { ELECTRUM_METHODS } from '../config/constants';
import type { ExtendedServerConfig, ServerConfig } from '../types/electrum';
import { DefaultPort, Network } from '../types/electrum';
import { logger } from '../utils/logger';

export const availableServerList: ServerConfig[] = [
  { host: 'bitcoinserver.nl', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'btc.electroncash.dk', port: 60004, useTls: true, network: Network.Mainnet },
  { host: 'node.xbt.eu', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'us11.einfachmalnettsein.de', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'b.1209k.com', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'blackie.c3-soft.com', port: 60004, useTls: true, network: Network.Testnet },
  { host: 'testnet1.bauerj.eu', port: DefaultPort.TLS, useTls: true, network: Network.Testnet },
  { host: '14.3.140.101', port: DefaultPort.TLS, useTls: true, network: Network.Testnet },
  { host: 'testnet.hsmiths.com', port: 53012, useTls: true, network: Network.Testnet },
  { host: 'testnet.qtornado.com', port: 51002, useTls: true, network: Network.Testnet },
  { host: 'testnet.blockstream.info', port: 993, useTls: true, network: Network.Testnet },
  { host: 'testnet.blockstream.info', port: 993, useTls: true, network: Network.Testnet },
  { host: 'testnet.aranguren.org', port: 51002, useTls: true, network: Network.Testnet },
  { host: 'testnetnode.arihanc.com', port: 51002, useTls: true, network: Network.Testnet },
  { host: 'electrum.akinbo.org', port: 51002, useTls: true, network: Network.Testnet },
  { host: 'ELEX05.blackpole.online', port: 52011, useTls: true, network: Network.Testnet },
  {
    host: '127.0.0.1/?host=testnet.aranguren.org&port-51002&tls=1',
    port: 8082,
    useTls: true,
    network: Network.Testnet,
  },
];

export async function selectBestServer(network: Network): Promise<ExtendedServerConfig> {
  let serverList = availableServerList.filter(server => server.network === network);

  const storageKey = `discoveredPeers_${network}`;
  const cached = await chrome.storage.local.get(storageKey);
  if (cached[storageKey]) {
    const discoveredPeers = cached[storageKey] as ServerConfig[];
    serverList = [...serverList, ...discoveredPeers];
  }

  if (serverList.length === 0) {
    throw new Error(`No servers available for ${network}`);
  }

  // Only scan first 20 servers max (5 hardcoded + 15 random discovered)
  const serversToScan = serverList.slice(0, 20);

  const scannedServers = await scanServers(serversToScan);
  const healthyServers = scannedServers.filter(server => server.healthy);

  if (healthyServers.length === 0) {
    throw new Error('No healthy servers found');
  }

  const maxBlockHeight = Math.max(...healthyServers.map(s => s.blockHeight || 0));
  const syncedServers =
    maxBlockHeight > 0 ? healthyServers.filter(s => s.blockHeight && maxBlockHeight - s.blockHeight <= 1) : [];

  const serversToRank = syncedServers.length > 0 ? syncedServers : healthyServers;

  serversToRank.sort((a, b) => a.latency! - b.latency!);
  return serversToRank[0];
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
      socket.send(JSON.stringify({ id: 1, method: ELECTRUM_METHODS.SERVER_VERSION, params: [] }));
      socket.send(JSON.stringify({ id: 2, method: ELECTRUM_METHODS.HEADERS_SUBSCRIBE, params: [] }));
    };

    // Wait for block height response before measuring latency
    socket.onmessage = (event: MessageEvent) => {
      try {
        const response = JSON.parse(event.data);
        // Store block height on the server object
        if (response.id === 2 && response.result) {
          server.blockHeight = response.result.height || response.result.block_height;
        }
        // Wait for block height response (id: 2) before closing
        if (response.id === 2) {
          clearTimeout(timeout);
          const end = performance.now();
          socket.close();
          resolve(end - start);
        }
      } catch {
        clearTimeout(timeout);
        socket.close();
        resolve(Number.MAX_SAFE_INTEGER);
      }
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      socket.close();
      resolve(Number.MAX_SAFE_INTEGER);
    };
  });
}

/**
 * Discovers peers from a given server using server.peers.subscribe RPC
 */
export async function discoverPeersFrom(server: ServerConfig): Promise<ServerConfig[]> {
  const protocol = server.useTls ? 'wss://' : 'ws://';
  const url = `${protocol}${server.host}:${server.port}`;

  return new Promise<ServerConfig[]>(resolve => {
    const socket = new WebSocket(url);
    const discoveredPeers: ServerConfig[] = [];
    const timeout = setTimeout(() => {
      socket.close();
      resolve(discoveredPeers);
    }, 5000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ id: 1, method: 'server.peers.subscribe', params: [] }));
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const response = JSON.parse(event.data);
        if (response.id === 1 && Array.isArray(response.result)) {
          for (const peer of response.result) {
            // Peer format: [ip, host, [version, protocol, ports...]]
            if (Array.isArray(peer) && peer.length >= 3) {
              const host = peer[1];

              // Skip .onion addresses
              if (host.endsWith('.onion')) continue;

              // Skip raw IP addresses (usually have cert issues)
              if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;

              const features = peer[2];

              // Look for SSL port (usually prefixed with 's')
              const sslPort = features.find((f: string) => f.startsWith('s'))?.substring(1);
              if (sslPort) {
                discoveredPeers.push({
                  host,
                  port: parseInt(sslPort),
                  useTls: true,
                  network: server.network,
                });
              }
            }
          }
          clearTimeout(timeout);
          socket.close();
          resolve(discoveredPeers);
        }
      } catch {
        logger.log('Error parsing server.peers.subscribe response:', event.data);
      }
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      socket.close();
      resolve(discoveredPeers);
    };
  });
}
