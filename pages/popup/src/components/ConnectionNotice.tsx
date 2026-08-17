import { useWalletContext } from '@src/context/WalletContext';
import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';

// The service worker recycles often and reports disconnected while it re-selects a server,
// so only a sustained outage is worth putting in front of the user.
const OUTAGE_GRACE_MS = 5_000;

/**
 * Tells the user their balances may be stale. Without it a wallet that cannot reach any
 * server looks exactly like an empty one.
 */
export const ConnectionNotice: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { connected, unlocked } = useWalletContext();
  const [outageConfirmed, setOutageConfirmed] = useState(false);
  const hasConnected = useRef(false);

  useEffect(() => {
    if (connected === 'connected') {
      hasConnected.current = true;
      setOutageConfirmed(false);
      return;
    }

    // A cold worker reports disconnected while it selects a server and shakes hands, which is
    // normal startup rather than an outage. Wait until a connection has succeeded once.
    if (!hasConnected.current) return;

    const timer = setTimeout(() => setOutageConfirmed(true), OUTAGE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  if (!unlocked || !outageConfirmed) return null;

  return (
    <div role="status" className={`w-full max-w-[346px] text-center text-xs text-amber-400 ${className}`}>
      Can&apos;t reach the Bitcoin network. Balances may be out of date.
    </div>
  );
};
