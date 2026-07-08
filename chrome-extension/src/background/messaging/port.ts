import browser from 'webextension-polyfill';
import type { ConnectionStatus, Network } from '@extension/backend/src/types/electrum';
import type { Balance } from '@extension/backend/src/types/wallet';
import { electrumService } from '@extension/backend/src/modules/electrumService';
import { createEmitter } from '@extension/backend/src/utils/emitter';

type ChuiPortListeningMessage = { type: 'PING' };
type PopupSessionUpdate = { activeCount: number };

type ChuiPortBroadcastMessage =
  | { type: 'SNAPSHOT'; data: unknown }
  | { type: 'CONNECTION'; status: ConnectionStatus; detail?: string; ts: number }
  | { type: 'BALANCE'; accountIndex: number; network: Network; balance: Balance; ts: number }
  | { type: 'TX'; accountIndex: number; tx: unknown; ts: number }
  | { type: 'PONG'; t: number };

const ports = new Set<browser.Runtime.Port>();
export const onPopupSessionChanged = createEmitter<PopupSessionUpdate>();

export function registerMessagePort() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'chui-app') return;
    ports.add(port);
    emitPopupSessionChanged();

    emitConnection(electrumService.status);

    port.onDisconnect.addListener(() => {
      ports.delete(port);
      emitPopupSessionChanged();
    });

    port.onMessage.addListener(message => {
      if ((message as ChuiPortListeningMessage).type === 'PING') port.postMessage({ type: 'PONG', t: Date.now() });
    });
  });
}

export function getActivePopupPortCount(): number {
  return ports.size;
}

function emitPopupSessionChanged(): void {
  onPopupSessionChanged.emit({ activeCount: ports.size });
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

export function emitBalance(accountIndex: number, network: Network, balance: Balance) {
  broadcast({ type: 'BALANCE', accountIndex, network, balance, ts: Date.now() });
}

export function emitTx(accountIndex: number, tx: unknown) {
  broadcast({ type: 'TX', accountIndex, tx, ts: Date.now() });
}
