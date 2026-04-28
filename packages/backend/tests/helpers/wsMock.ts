type Listener = (event: unknown) => void;

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
