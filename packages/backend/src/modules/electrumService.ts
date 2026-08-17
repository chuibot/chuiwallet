import * as bitcoin from 'bitcoinjs-lib';
import type {
  ConnectionStatus,
  ConnectionUpdate,
  ElectrumHistory,
  ElectrumMerkleProof,
  ElectrumUtxo,
  ExtendedServerConfig,
  TipHeader,
} from '../types/electrum';
import { logger } from '../utils/logger';
import { Network } from '../types/electrum';
import { ElectrumRpcClient, REQUEST_TIMEOUT_DETAIL } from './electrumRpcClient';
import { getConsensusTip, selectBestServer } from './electrumServer';
import { createEmitter } from '../utils/emitter';
import {
  assertBlockHeader,
  assertElectrumHistoryBatch,
  assertElectrumMerkleProof,
  assertElectrumTransaction,
  assertElectrumUtxoBatch,
} from '../utils/electrumValidation';

/**
 * A rotation that lost to a newer connect(), a network switch, or a teardown. Callers must
 * treat it as "someone else owns the connection now", not as a failure to recover from.
 */
export class SupersededConnectError extends Error {
  constructor() {
    super('Electrum connect superseded');
    this.name = 'SupersededConnectError';
  }
}

/** How long a server sits out after wedging mid-request versus merely failing to connect. */
const STALL_COOLDOWN_MS = 10 * 60_000;
const FAILED_COOLDOWN_MS = 2 * 60_000;
/** Per-pass budget, so a dead pool cannot block a network switch behind a long walk. */
const ROTATION_DEADLINE_MS = 30_000;
const BROADCAST_TIMEOUT_MS = 30_000;

export class ElectrumService {
  private network: Network = Network.Mainnet;
  private rpcClient: ElectrumRpcClient | undefined;
  private healthyServers: ExtendedServerConfig[] = [];
  private selectedServer: ExtendedServerConfig | undefined;
  private headerCache = new Map<number, string>();
  private suppressClientDisconnectStatus = false;
  private connectEpoch = 0;
  private pendingCandidate: ElectrumRpcClient | undefined;
  private cooldownUntil = new Map<string, number>();
  public status: ConnectionStatus = 'disconnected';
  public readonly onStatus = createEmitter<ConnectionUpdate>();

  public async init(network: Network) {
    this.network = network;
    this.connectEpoch++;
    const { server, healthyServers } = await selectBestServer(this.network);
    this.healthyServers = healthyServers;
    this.selectedServer = server;
    this.rpcClient = this.wireClient(server);
    return this;
  }

  /**
   * Build a client for `server` without adopting it. Status events stay gated on identity, so a
   * candidate that fails mid-rotation is silent and cannot trigger a competing reconnect.
   */
  private wireClient(server: ExtendedServerConfig): ElectrumRpcClient {
    const client = new ElectrumRpcClient(server);
    client.onStatus.on(status => {
      if (this.rpcClient !== client) return;
      // disconnect() already emitted the canonical event with its reason; the client's
      // reasonless follow-up would slip past the background listener's switchNetwork check
      // and schedule a reconnect mid-switch.
      if (this.suppressClientDisconnectStatus && status.status === 'disconnected') return;
      if (status.detail === REQUEST_TIMEOUT_DETAIL) {
        this.cooldownUntil.set(server.host, Date.now() + STALL_COOLDOWN_MS);
      }
      this.setStatus(status.status, status.detail);
    });
    return client;
  }

  /** Current pick first, then the rest; servers still cooling off go last rather than first. */
  private rotationOrder(servers: ExtendedServerConfig[]): ExtendedServerConfig[] {
    const selectedHost = this.selectedServer?.host;
    const ordered = servers.filter(server => server.host === selectedHost);
    ordered.push(...servers.filter(server => server.host !== selectedHost));

    const now = Date.now();
    const cooledAt = (server: ExtendedServerConfig) => this.cooldownUntil.get(server.host) ?? 0;
    const available = ordered.filter(server => cooledAt(server) <= now);
    if (available.length > 0) return available;

    // Everything is cooling; a stale server still beats no connection, so try whichever
    // has been sitting out longest.
    return [...ordered].sort((a, b) => cooledAt(a) - cooledAt(b));
  }

  public async connect() {
    const epoch = ++this.connectEpoch;
    const assertCurrent = () => {
      if (this.connectEpoch !== epoch) throw new SupersededConnectError();
    };

    // Any candidate still dialling belongs to a rotation this call just superseded.
    this.pendingCandidate?.disconnect();
    this.pendingCandidate = undefined;

    let lastError = new Error('No healthy servers found');

    // Budgeted per phase, so a slow first pass cannot consume the rescan's turn.
    const rotate = async (servers: ExtendedServerConfig[]): Promise<boolean> => {
      const deadline = Date.now() + ROTATION_DEADLINE_MS;
      for (const server of this.rotationOrder(servers)) {
        assertCurrent();
        if (Date.now() > deadline) {
          lastError = new Error(`Timed out trying Electrum servers for ${this.network}`);
          break;
        }

        const candidate = this.wireClient(server);
        this.pendingCandidate = candidate;
        try {
          logger.log(`Connecting Electrum server ${server.host}:${server.port}`);
          await candidate.connect();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Electrum server unavailable: ${server.host}`, lastError.message);
          // A superseded rotation must not record a verdict on a host it abandoned.
          if (this.connectEpoch === epoch) {
            this.cooldownUntil.set(server.host, Date.now() + FAILED_COOLDOWN_MS);
          }
          continue;
        } finally {
          if (this.pendingCandidate === candidate) this.pendingCandidate = undefined;
        }

        if (this.connectEpoch !== epoch) {
          candidate.disconnect();
          throw new SupersededConnectError();
        }

        const previous = this.rpcClient;
        // Adopt before announcing: listeners issue RPCs the moment 'connected' lands.
        this.rpcClient = candidate;
        this.selectedServer = server;
        this.cooldownUntil.delete(server.host);
        previous?.disconnect();
        this.setStatus('connected');
        return true;
      }
      return false;
    };

    try {
      if (await rotate(this.healthyServers)) return;

      assertCurrent();
      // Force a fresh scan: the cached list is exactly the one that just failed.
      const { healthyServers } = await selectBestServer(this.network, { refresh: true });
      assertCurrent();
      this.healthyServers = healthyServers;
      if (await rotate(healthyServers)) return;

      throw lastError;
    } catch (error) {
      if (error instanceof SupersededConnectError) throw error;
      // One reasonless 'disconnected' for the whole rotation: the background listener keys
      // its backoff off this event, and walletManager re-tags it during a network rollback.
      if (this.connectEpoch === epoch) {
        this.setStatus('disconnected', error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  public disconnect(reason?: string) {
    logger.log('Disconnecting Electrum server', reason);
    this.connectEpoch++;
    this.setStatus('disconnected', undefined, reason);
    this.suppressClientDisconnectStatus = true;
    try {
      this.rpcClient?.disconnect();
    } finally {
      this.suppressClientDisconnectStatus = false;
    }
    // A rotation candidate is never rpcClient, so the line above misses it; without this a
    // network switch leaves it dialling the old network until its connect timeout expires.
    this.pendingCandidate?.disconnect();
    this.pendingCandidate = undefined;
    this.headerCache.clear();
  }

  private setStatus(status: ConnectionStatus, detail?: string, reason?: string) {
    this.status = status;
    this.onStatus.emit({ status, detail, reason, ts: Date.now() });
  }

  public async getRawTransaction(txid: string, verbose = false) {
    if (!this.rpcClient) throw new Error('Electrum not connected');
    const response = await this.rpcClient.sendRequest('blockchain.transaction.get', [txid, verbose]);

    if (!verbose && typeof response === 'string') return response;

    if (verbose) {
      assertElectrumTransaction(response);
      return response;
    }

    throw new Error(`Unexpected response for transaction ${txid}`);
  }

  public async getHistoryBatch(scriptHashes: string[][]): Promise<ElectrumHistory[]> {
    if (!this.rpcClient) throw new Error('Electrum not connected');
    const response = await this.rpcClient.sendBatchRequest('blockchain.scripthash.get_history', scriptHashes);
    assertElectrumHistoryBatch(response);
    return response;
  }

  public async getUtxoBatch(scriptHashes: string[][]): Promise<ElectrumUtxo[][]> {
    if (!this.rpcClient) throw new Error('Electrum not connected');
    const response = await this.rpcClient.sendBatchRequest('blockchain.scripthash.listunspent', scriptHashes);
    assertElectrumUtxoBatch(response);
    return response;
  }

  public async broadcastTx(rawTxHex: string): Promise<string> {
    if (!this.rpcClient) throw new Error('Electrum not connected');

    const hex = rawTxHex.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error('Invalid transaction hex');
    }

    // CRYPTO-W2-001 / CHUI-AUDIT-004: compute the txid locally. A malicious
    // Electrum server could otherwise return an attacker-controlled txid that
    // walletManager would then write into the user's optimistic history.
    let localTxid: string;
    try {
      localTxid = bitcoin.Transaction.fromHex(hex).getId();
    } catch {
      throw new Error('Invalid transaction hex');
    }

    try {
      // A broadcast that times out may still have reached the mempool, so this one request
      // neither drops the connection nor reports a plain failure the user would retry blindly.
      const response = await this.rpcClient.sendRequest('blockchain.transaction.broadcast', [hex], {
        timeoutMs: BROADCAST_TIMEOUT_MS,
        disconnectOnTimeout: false,
      });
      if (typeof response !== 'string' || !/^[0-9a-f]{64}$/i.test(response)) {
        throw new Error(`Unexpected broadcast result: ${String(response)}`);
      }
      // Ignore `response`; trust only the locally derived txid.
      return localTxid;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('timed out')) {
        throw new Error(
          `Broadcast timed out. Transaction ${localTxid} may already have been broadcast — check an explorer before resending.`,
        );
      }
      throw new Error(`Broadcast failed: ${msg}`);
    }
  }

  async getTipHeader(): Promise<TipHeader> {
    return getConsensusTip(this.healthyServers);
  }

  async getTipHeight(): Promise<number> {
    return (await this.getTipHeader()).height;
  }

  public async getMerkleProof(txid: string, height: number): Promise<ElectrumMerkleProof> {
    if (!this.rpcClient) throw new Error('Electrum not connected');
    const response = await this.rpcClient.sendRequest('blockchain.transaction.get_merkle', [txid, height]);
    assertElectrumMerkleProof(response);
    return response;
  }

  public async getBlockHeader(height: number): Promise<string> {
    const cached = this.headerCache.get(height);
    if (cached) return cached;
    if (!this.rpcClient) throw new Error('Electrum not connected');
    const response = await this.rpcClient.sendRequest('blockchain.block.header', [height]);
    assertBlockHeader(response);
    this.headerCache.set(height, response);
    return response;
  }

  public async sendRequest(methodName: string, params: unknown[]) {
    return this.rpcClient?.sendRequest(methodName, params);
  }

  public async sendBatchRequest(methodName: string, params: unknown[][]) {
    return this.rpcClient?.sendBatchRequest(methodName, params);
  }
}

export const electrumService = new ElectrumService();
