import type { ExtendedServerConfig, ServerConfig } from '../types/electrum';
import { DefaultPort, Network } from '../types/electrum';

export const availableServerList: ServerConfig[] = [
  { host: 'bitcoinserver.nl', port: 50004, useTls: true, network: Network.Mainnet },
  { host: 'btc.electroncash.dk', port: 60004, useTls: true, network: Network.Mainnet },
  { host: 'node.xbt.eu', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'us11.einfachmalnettsein.de', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'b.1209k.com', port: DefaultPort.TLS, useTls: true, network: Network.Mainnet },
  { host: 'testnet4.electrs.btcscan.net', port: 443, useTls: true, network: Network.Testnet },
  // { host: 'blackie.c3-soft.com', port: 60004, useTls: true, network: Network.Testnet },
  // { host: 'testnet1.bauerj.eu', port: DefaultPort.TLS, useTls: true, network: Network.Testnet },
  // { host: '14.3.140.101', port: DefaultPort.TLS, useTls: true, network: Network.Testnet },
  // { host: 'testnet.hsmiths.com', port: 53012, useTls: true, network: Network.Testnet },
  // { host: 'testnet.qtornado.com', port: 51002, useTls: true, network: Network.Testnet },
  // { host: 'testnet.blockstream.info', port: 993, useTls: true, network: Network.Testnet },
  // { host: 'testnet.blockstream.info', port: 993, useTls: true, network: Network.Testnet },
  // { host: 'testnet.aranguren.org', port: 51002, useTls: true, network: Network.Testnet },
  // { host: 'testnetnode.arihanc.com', port: 51002, useTls: true, network: Network.Testnet },
  // { host: 'electrum.akinbo.org', port: 51002, useTls: true, network: Network.Testnet },
  // { host: 'ELEX05.blackpole.online', port: 52011, useTls: true, network: Network.Testnet },
];

export async function selectBestServer(network: Network): Promise<ExtendedServerConfig> {
  const serverList = availableServerList.filter(server => server.network === network);
  if (serverList.length === 0) {
    throw new Error(`No servers available for ${network}`);
  }

  const scannedServers = await scanServers(serverList);
  const healthyServers = scannedServers.filter(server => server.healthy);
  if (healthyServers.length === 0) {
    throw new Error('No healthy servers found');
  }

  // Sort by latency.
  healthyServers.sort((a, b) => a.latency! - b.latency!);
  return healthyServers[0];
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
