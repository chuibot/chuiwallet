import type { ConnectionStatus } from '@extension/backend/dist/types/electrum';
import browser from 'webextension-polyfill';
import { electrumService } from '@extension/backend/dist/modules/electrumService';

type ChuiPortListeningMessage = { type: 'PING' };

type ChuiPortBroadcastMessage =
  | { type: 'SNAPSHOT'; data: unknown }
  | { type: 'CONNECTION'; status: ConnectionStatus; detail?: string; ts: number }
  | { type: 'BALANCE'; accountIndex: number; sat: number; fiat?: number; ts: number }
  | { type: 'TX'; accountIndex: number; tx: unknown; ts: number }
  | { type: 'PONG'; t: number };

const ports = new Set<browser.Runtime.Port>();

export function registerMessagePort() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'chui-app') return;
    ports.add(port);

    emitConnection(electrumService.status);

    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });

    port.onMessage.addListener(message => {
      if ((message as ChuiPortListeningMessage).type === 'PING') port.postMessage({ type: 'PONG', t: Date.now() });
    });
  });
}

function broadcast(payload: ChuiPortBroadcastMessage) {
  for (const p of ports) {
    try {
      p.postMessage(payload);
    } catch {
      ports.delete(p);
    }
  }
}

export function emitConnection(status: ConnectionStatus, detail?: string) {
  broadcast({ type: 'CONNECTION', status, detail, ts: Date.now() });
}

export function emitBalance(accountIndex: number, sat: number, fiat?: number) {
  broadcast({ type: 'BALANCE', accountIndex, sat, fiat, ts: Date.now() });
}

export function emitTx(accountIndex: number, tx: any) {
  broadcast({ type: 'TX', accountIndex, tx, ts: Date.now() });
}
