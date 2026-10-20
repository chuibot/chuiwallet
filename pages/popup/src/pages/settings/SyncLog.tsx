import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import Header from '@src/components/Header';
import { Button } from '@src/components/Button';
import { useWalletContext } from '@src/context/WalletContext';
import { sendMessage } from '@src/utils/bridge';
import type { SyncLogEntry, SyncStatus } from '@extension/backend/src/modules/syncLog';
import type { ScanProgress } from '@extension/backend/src/types/cache';

const STATUS: Record<SyncStatus, { label: string; detail?: string }> = {
  completed: { label: 'Completed' },
  offline: { label: 'Offline', detail: 'No connection to a Bitcoin server.' },
  interrupted: { label: 'Interrupted', detail: 'The account or network changed before it finished.' },
  failed: { label: 'Failed' },
};

function describeChain(label: string, { highestScanned, highestUsed }: ScanProgress): string {
  const used = highestUsed < 0 ? 'none used' : `last used ${highestUsed}`;
  return `${label}: checked index 0 to ${highestScanned}, ${used}`;
}

export const SyncLog: React.FC = () => {
  const { activeAccount, balanceSyncing, resync } = useWalletContext();
  const [entries, setEntries] = useState<SyncLogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const busy = running || balanceSyncing;
  const network = activeAccount?.network;
  const accountIndex = activeAccount?.index;

  const loadEntries = useCallback(async () => {
    try {
      setEntries(await sendMessage<SyncLogEntry[]>('scan.log'));
    } catch (e) {
      console.error('Failed to load sync log', e);
    }
  }, []);

  useEffect(() => {
    setEntries([]);
  }, [network, accountIndex]);

  // Keyed on the account too, because a switch to an account already synced this session leaves balanceSyncing false.
  useEffect(() => {
    if (balanceSyncing) return;
    let cancelled = false;
    sendMessage<SyncLogEntry[]>('scan.log')
      .then(rows => {
        if (!cancelled) setEntries(rows);
      })
      .catch(e => console.error('Failed to load sync log', e));
    return () => {
      cancelled = true;
    };
  }, [network, accountIndex, balanceSyncing]);

  const handleResync = async () => {
    setRunning(true);
    await resync();
    await loadEntries();
    setRunning(false);
  };

  return (
    <div className="flex flex-col h-full bg-dark text-white px-4 pt-12 pb-[19px]">
      <Header title="Sync Log" />
      <p className="mt-6 text-sm text-foreground">
        Resync checks every Bitcoin address derived for this account, then looks ahead for newly used ones.
      </p>
      <ul className="flex flex-col flex-1 min-h-0 gap-2 mt-4 overflow-y-auto">
        {entries.length === 0 ? (
          <li className="text-sm text-foreground">No resyncs yet.</li>
        ) : (
          entries.map(entry => (
            <li key={entry.startedAt} className="flex flex-col gap-1 p-3 rounded-lg bg-zinc-800 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-foreground">{new Date(entry.startedAt).toLocaleString()}</span>
                <span className={entry.status === 'completed' ? 'text-green-500' : 'text-amber-400'}>
                  {STATUS[entry.status].label}
                </span>
              </div>
              {STATUS[entry.status].detail && <span>{STATUS[entry.status].detail}</span>}
              {entry.error && <span className="break-words text-primary-red">{entry.error}</span>}
              {entry.receive && <span>{describeChain('Receive', entry.receive)}</span>}
              {entry.change && <span>{describeChain('Change', entry.change)}</span>}
            </li>
          ))
        )}
      </ul>
      <Button className="mt-4 self-center" onClick={handleResync} disabled={busy}>
        {busy ? 'Syncing...' : 'Resync wallet'}
      </Button>
    </div>
  );
};

export default SyncLog;
