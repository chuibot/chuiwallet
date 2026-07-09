import { useEffect, useRef } from 'react';
import type { BalanceData, Network } from '@src/types';

type ChuiPortEvent = {
  type: string;
  status?: string;
  accountIndex?: number;
  network?: Network;
  balance?: BalanceData;
  ts?: number;
};

const HEARTBEAT_MS = 20_000;
const RECONNECT_MS = 500;

export function useChuiEvents(handlers: {
  onSnapshot?: (d: ChuiPortEvent) => void;
  onBalance?: (e: ChuiPortEvent) => void;
  onTx?: (e: ChuiPortEvent) => void;
  onConnection?: (e: ChuiPortEvent) => void;
}) {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let stopped = false;
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const clearKeepAlive = () => {
      if (!keepAlive) return;
      clearInterval(keepAlive);
      keepAlive = null;
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      if (reconnect) clearTimeout(reconnect);
      reconnect = setTimeout(connect, RECONNECT_MS);
    };

    const connect = () => {
      if (stopped) return;
      const port = chrome.runtime.connect({ name: 'chui-app' });
      portRef.current = port;

      port.onMessage.addListener((msg: ChuiPortEvent) => {
        const current = handlersRef.current;
        if (msg.type === 'BALANCE') current.onBalance?.(msg);
        else if (msg.type === 'TX') current.onTx?.(msg);
        else if (msg.type === 'CONNECTION') current.onConnection?.(msg);
      });

      clearKeepAlive();
      keepAlive = setInterval(() => {
        try {
          port.postMessage({ type: 'PING' });
        } catch {
          if (portRef.current === port) portRef.current = null;
          clearKeepAlive();
          scheduleReconnect();
        }
      }, HEARTBEAT_MS);

      port.onDisconnect.addListener(() => {
        if (portRef.current === port) portRef.current = null;
        clearKeepAlive();
        scheduleReconnect();
      });
    };

    connect();

    return () => {
      stopped = true;
      clearKeepAlive();
      if (reconnect) clearTimeout(reconnect);
      try {
        portRef.current?.disconnect();
      } catch {
        /* empty */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
