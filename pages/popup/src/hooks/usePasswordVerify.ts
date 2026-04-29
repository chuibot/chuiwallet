import { useCallback, useEffect, useState } from 'react';
import { BridgeError, sendMessage } from '@src/utils/bridge';
import { ERROR_MESSAGES } from '@src/constants';

type VerifyResult = { status: 'success' } | { status: 'incorrect' } | { status: 'locked' } | { status: 'error' };

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function usePasswordVerify() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) {
        setLockedUntil(null);
        setErrorMsg('');
      }
    };
    const interval = setInterval(tick, 1000);
    tick();
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const remainingMs = lockedUntil === null ? 0 : Math.max(0, lockedUntil - now);
  const isLocked = remainingMs > 0;

  const verify = useCallback(async (password: string): Promise<VerifyResult> => {
    setLoading(true);
    setErrorMsg('');
    try {
      const ok = await sendMessage<boolean>('wallet.verifyPassword', { password });
      if (ok) {
        setLockedUntil(null);
        return { status: 'success' };
      }
      setErrorMsg(ERROR_MESSAGES.INCORRECT_PASSWORD);
      return { status: 'incorrect' };
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'RATE_LIMITED') {
        const data = err.data as { remainingMs?: unknown } | undefined;
        const ms = typeof data?.remainingMs === 'number' && data.remainingMs > 0 ? data.remainingMs : 0;
        if (ms > 0) {
          setLockedUntil(Date.now() + ms);
          return { status: 'locked' };
        }
        setErrorMsg(ERROR_MESSAGES.TOO_MANY_PASSWORD_ATTEMPTS);
        return { status: 'locked' };
      }
      console.error('wallet.verifyPassword failed:', err);
      const message = err instanceof Error && err.message ? err.message : ERROR_MESSAGES.SOMETHING_WENT_WRONG;
      setErrorMsg(message);
      return { status: 'error' };
    } finally {
      setLoading(false);
    }
  }, []);

  const lockoutMessage = isLocked ? `Too many failed attempts. Try again in ${formatRemaining(remainingMs)}.` : '';
  const displayError = lockoutMessage || errorMsg;

  return {
    verify,
    loading,
    isLocked,
    disabled: loading || isLocked,
    errorMsg: displayError,
  };
}
