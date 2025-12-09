import { useEffect, useRef } from 'react';

export function useChuiEvents(handlers: {
  onSnapshot?: (d: any) => void;
  onBalance?: (e: any) => void;
  onTx?: (e: any) => void;
  onConnection?: (e: any) => void;
}) {
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'chui-app' });
    portRef.current = port;

    port.onMessage.addListener((msg: ChuiPortEvent) => {
      console.log('Port Received', msg);
      if (msg.type === 'BALANCE') handlers.onBalance?.(msg);
      else if (msg.type === 'TX') handlers.onTx?.(msg);
      else if (msg.type === 'CONNECTION') handlers.onConnection?.(msg);
    });

    const keepAlive = setInterval(() => port.postMessage({ type: 'PING' }), 45_000);

    port.onDisconnect.addListener(() => {
      portRef.current = null;
      clearInterval(keepAlive);
    });
    return () => {
      clearInterval(keepAlive);
      try {
        port.disconnect();
      } catch {
        /* empty */
      }
    };
  }, []);
}
