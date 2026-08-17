import { CHAIN_CHECKPOINTS } from '../../src/modules/electrumHandshake';
import { Network } from '../../src/types/electrum';

type Listener = (event: unknown) => void;

/** Real headers whose hashes match CHAIN_CHECKPOINTS, so the client's chain check passes genuinely. */
export const CHECKPOINT_HEADERS: Record<Network, string> = {
  [Network.Mainnet]:
    '000000201929eb850a74427d0440cf6b518308837566cd6d0662790000000000000000001f6231ed3de07345b607ec2a39b2d01bec2fe10dfb7f516ba4958a42691c95316d0a385a459600185599fc5c',
  [Network.Testnet]:
    '0020b42b030216aa3bfeb2cffb069ffe3a9b0de3db50c75112279e4f1200000000000000456d7ffa5b03f0e8a4a2e10c296a2d140128e32728886aa304135e8d1cd1d0caeac2c06604fa54195ec4d06c',
};

type SentRequest = { jsonrpc?: string; id: number; method: string; params: unknown[] };

type HandshakeOverrides = {
  network?: Network;
  version?: unknown;
  header?: unknown;
  versionError?: { message: string };
};

export class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  static lastInstance: FakeWebSocket | null = null;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onerror: Listener | null = null;
  onclose: Listener | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.lastInstance = this;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    // Browsers deliver this on a later task, never synchronously from close().
    queueMicrotask(() => this.onclose?.({ code: 1000 }));
  }

  triggerClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }

  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  triggerMessage(data: string): void {
    this.onmessage?.({ data });
  }

  triggerError(message = 'boom'): void {
    this.onerror?.({ message });
  }

  /** Every JSON-RPC request written to this socket, batch frames flattened. */
  sentRequests(): SentRequest[] {
    return this.sent.flatMap(frame => {
      try {
        const parsed: unknown = JSON.parse(frame);
        return (Array.isArray(parsed) ? parsed : [parsed]) as SentRequest[];
      } catch {
        return [];
      }
    });
  }

  /**
   * Answer the connect handshake so ElectrumRpcClient.connect() can resolve. Polls because the
   * client sends server.version first and only issues the header request once that resolves.
   */
  async answerHandshake(overrides: HandshakeOverrides = {}): Promise<void> {
    const network = overrides.network ?? Network.Mainnet;

    const version = await this.waitForRequest('server.version');
    if (overrides.versionError) {
      this.triggerMessage(JSON.stringify({ jsonrpc: '2.0', id: version.id, error: overrides.versionError }));
      return;
    }
    this.triggerMessage(
      JSON.stringify({ jsonrpc: '2.0', id: version.id, result: overrides.version ?? ['Fulcrum 2.1.1', '1.4'] }),
    );

    const header = await this.waitForRequest('blockchain.block.header');
    expectCheckpointHeight(header, network);
    this.triggerMessage(
      JSON.stringify({ jsonrpc: '2.0', id: header.id, result: overrides.header ?? CHECKPOINT_HEADERS[network] }),
    );
  }

  async openAndHandshake(overrides: HandshakeOverrides = {}): Promise<void> {
    this.triggerOpen();
    await this.answerHandshake(overrides);
  }

  // Yields microtasks rather than timers: the client chains its handshake requests through
  // promise continuations, so this resolves under jest fake timers too.
  private async waitForRequest(method: string): Promise<SentRequest> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const request = this.sentRequests().find(r => r.method === method && !this.answered.has(r.id));
      if (request) {
        this.answered.add(request.id);
        return request;
      }
      await Promise.resolve();
    }
    throw new Error(`FakeWebSocket: no ${method} request was sent on ${this.url}`);
  }

  private answered = new Set<number>();
}

function expectCheckpointHeight(request: SentRequest, network: Network): void {
  const expected = CHAIN_CHECKPOINTS[network].height;
  if (request.params?.[0] !== expected) {
    throw new Error(`FakeWebSocket: expected checkpoint height ${expected}, got ${String(request.params?.[0])}`);
  }
}

let originalWS: typeof WebSocket | undefined;

export function installWebSocketMock(): void {
  if (!originalWS) originalWS = globalThis.WebSocket as typeof WebSocket;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
}

export function restoreWebSocket(): void {
  if (originalWS) (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWS;
}

export function resetWebSocketMock(): void {
  FakeWebSocket.instances.length = 0;
  FakeWebSocket.lastInstance = null;
}
