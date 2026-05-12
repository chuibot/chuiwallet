import type {
  ConnectionStatus,
  ConnectionUpdate,
  ElectrumHistory,
  ElectrumMerkleProof,
  ElectrumTransaction,
  ElectrumUtxo,
  ExtendedServerConfig,
  TipHeader,
} from '../types/electrum';
import { logger } from '../utils/logger';
import { Network } from '../types/electrum';
import { ElectrumRpcClient } from './electrumRpcClient';
import { getConsensusTip, selectBestServer } from './electrumServer';
import { createEmitter } from '../utils/emitter';
import {
  assertBlockHeader,
  assertElectrumHistoryBatch,
  assertElectrumMerkleProof,
  assertElectrumTransaction,
  assertElectrumUtxoBatch,
} from '../utils/electrumValidation';

export class ElectrumService {
  private network: Network = Network.Mainnet;
  private rpcClient: ElectrumRpcClient | undefined;
  private healthyServers: ExtendedServerConfig[] = [];
  private headerCache = new Map<number, string>();
  public status: ConnectionStatus = 'disconnected';
  public readonly onStatus = createEmitter<ConnectionUpdate>();

  public async init(network: Network) {
    this.network = network;
    const { server, healthyServers } = await selectBestServer(this.network);
    this.healthyServers = healthyServers;
    this.rpcClient = new ElectrumRpcClient(server);
    this.rpcClient.onStatus.on(status => {
      this.setStatus(status.status, status.detail);
    });
    return this;
  }

  public async connect() {
    if (this.rpcClient) {
      logger.log('Connecting Electrum server');
      await this.rpcClient.connect();
    }
  }

  public disconnect(reason?: string) {
    logger.log('Disconnecting Electrum server', reason);
    this.setStatus('disconnected', undefined, reason);
    this.rpcClient?.disconnect();
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

    try {
      const response = await this.rpcClient.sendRequest('blockchain.transaction.broadcast', [hex]);
      if (typeof response === 'string' && /^[0-9a-f]{64}$/i.test(response)) {
        return response;
      }
      throw new Error(`Unexpected broadcast result: ${String(response)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
