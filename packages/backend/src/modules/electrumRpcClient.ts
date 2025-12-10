import type { ConnectionStatus, ConnectionUpdate, ExtendedServerConfig, ServerConfig } from '../types/electrum';
import { logger } from '../utils/logger';
import { createEmitter } from '../utils/emitter';

type RequestResolver = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type JsonRpcObject = {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown[];
};

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { message?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
};

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as { id?: unknown };
  return typeof v.id === 'number';
}

/**
 * Client for making RPC calls to an Electrum server over WebSocket.
 * Handles connection, disconnection, and request/response management.
 * Todo: Improve failover switch connection
 */
export class ElectrumRpcClient {
  private server: ServerConfig | ExtendedServerConfig;
  private socket: WebSocket | null;
  private requests: Map<number, RequestResolver> = new Map();
  private jsonRpcVersion: string = '2.0';
  private runningRequestId: number = 0;
  private buffer: string = '';
  public readonly onStatus = createEmitter<ConnectionUpdate>();

  /**
   * Constructs a new ElectrumRpcClient instance.
   * @param {ServerConfig | ExtendedServerConfig} server - The server configuration
   */
  constructor(server: ServerConfig | ExtendedServerConfig) {
    this.server = server;
    this.socket = null;
  }

  /**
   * Establishes a WebSocket connection to the Electrum server.
   * @returns {Promise<ElectrumRpcClient>} A promise that resolves with once connected.
   */
  public async connect(): Promise<ElectrumRpcClient> {
    return new Promise((resolve, reject) => {
      const protocol = this.server.useTls ? 'wss://' : 'ws://';
      const wsUrl = `${protocol}${this.server.host}:${this.server.port}`;
      this.disconnect();

      this.socket = new WebSocket(wsUrl);
      this.socket.onopen = () => {
        logger.log(`Connected to Electrum server at ${wsUrl}`);
        this.setStatus('connected');
        resolve(this);
      };

      this.socket.onmessage = (event: MessageEvent) => {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        this.handleIncomingChunk(raw);
      };

      this.socket.onerror = (error: Event) => {
        const errorMessage = 'WebSocket error: ' + (error as ErrorEvent).message || 'Unknown error';
        logger.error(errorMessage, error);
        this.setStatus('error', errorMessage);
        this.disconnect();
        reject(new Error(errorMessage));
      };

      this.socket.onclose = () => {
        this.disconnect();
        logger.warn('WebSocket closed');
      };
    });
  }

  /**
   * Disconnects from the Electrum server by closing the WebSocket.
   * All pending requests will be rejected upon closure.
   */
  public disconnect() {
    if (!this.socket) return;
    this.requests.forEach(request => request.reject(new Error('Websocket closed')));
    this.requests.clear();
    this.socket.close();
    this.socket = null;
    this.buffer = '';
    this.setStatus('disconnected');
  }

  /**
   * set and emit connection status
   * @param status
   * @param detail
   * @private
   */
  private setStatus(status: ConnectionStatus, detail?: string) {
    this.onStatus.emit({ status, detail, ts: Date.now() });
  }

  /**
   * Handle a raw text chunk from the WebSocket.
   * Accumulates into a buffer and processes newline-delimited JSON messages.
   */
  private handleIncomingChunk(raw: string): void {
    this.buffer += raw;

    let idx: number;
    // Process as many complete lines as we have
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);

      if (!line) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(line) as unknown;
      } catch (e) {
        logger.error('Failed to parse Electrum message', e, line);
        continue;
      }

      this.dispatchRpcPayload(payload);
    }
  }

  /**
   * Handle parsed JSON-RPC payload from Electrum.
   * Both single-object and batch (array) responses.
   */
  private dispatchRpcPayload(payload: unknown): void {
    try {
      const rawMessages = Array.isArray(payload) ? payload : [payload];

      for (const raw of rawMessages) {
        if (!isJsonRpcResponse(raw)) {
          logger.warn('Ignoring non-RPC message from Electrum', raw);
          continue;
        }

        const { id, result, error } = raw;
        const resolver = this.requests.get(id);
        if (!resolver) continue;

        this.requests.delete(id);

        if (error) {
          const message = error.message ?? 'Electrum error';
          resolver.reject(new Error(message));
        } else {
          resolver.resolve(result);
        }
      }
    } catch (err) {
      logger.error('Failed to handle Electrum message', err, payload);
    }
  }

  /**
   * Sends an RPC request to Electrum server.
   * @param {string} method - The Electrum RPC method name (e.g., 'server.version').
   * @param {unknown[]} [params=[]] - Optional parameters for the RPC call.
   * @returns {Promise<unknown>} A promise that resolves with the RPC result or rejects on error.
   */
  public async sendRequest(method: string, params: unknown[] = []): Promise<unknown> {
    this.assertSocketConnection();
    return new Promise((resolve, reject) => {
      const id = ++this.runningRequestId;
      const request = JSON.stringify(this.rpcRequestObject(id, method, params));
      this.requests.set(id, { resolve, reject });
      this.socket?.send(request);
    });
  }

  /**
   * Sends a batch of RPC requests to the Electrum server using the same method but different parameters.
   * @param {string} method - The Electrum RPC method name (e.g., 'blockchain.scripthash.get_balance').
   * @param {unknown[][]} paramSets - An array of parameter sets for the batch calls.
   * @returns {Promise<unknown[]>} A promise that resolves with an array of results in the order of the input paramSets.
   */
  public async sendBatchRequest(method: string, paramSets: unknown[][] = []): Promise<unknown[]> {
    this.assertSocketConnection();
    const batchRequests = paramSets.map(params => {
      const id = ++this.runningRequestId;
      return this.rpcRequestObject(id, method, params);
    });

    const requestResolvers = batchRequests.map(
      ({ id }) =>
        new Promise<unknown>((resolve, reject) => {
          this.requests.set(id, { resolve, reject });
        }),
    );

    const requestJson = JSON.stringify(batchRequests);
    this.socket?.send(requestJson);
    return Promise.all(requestResolvers);
  }

  private rpcRequestObject(id: number, method: string, params: unknown[]): JsonRpcObject {
    return { jsonrpc: this.jsonRpcVersion, id, method, params };
  }

  private assertSocketConnection() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      const errorMessage =
        'WebSocket is not open - connection state: ' + (this.socket ? this.socket.readyState : 'null');
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}
