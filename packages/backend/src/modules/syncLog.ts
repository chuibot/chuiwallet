import browser from 'webextension-polyfill';
import type { ScanProgress } from '../types/cache';
import type { Network } from '../types/electrum';

export type SyncStatus = 'completed' | 'offline' | 'interrupted' | 'failed';

export interface SyncLogEntry {
  startedAt: number;
  finishedAt: number;
  status: SyncStatus;
  error?: string;
  receive?: ScanProgress;
  change?: ScanProgress;
}

interface SyncLogScope {
  network: Network;
  accountIndex: number;
}

export class SyncLog {
  private static readonly STORAGE_KEY_PREFIX = 'sync_log:';
  private static readonly MAX_ENTRIES = 20;

  // Bumped by clear() so a resync still running at logout cannot write its entry back.
  private generation = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  captureGeneration(): number {
    return this.generation;
  }

  /** Newest first. */
  async get(scope: SyncLogScope): Promise<SyncLogEntry[]> {
    const key = this.getStorageKey(scope);
    const stored = await browser.storage.local.get(key);
    return Array.isArray(stored[key]) ? (stored[key] as SyncLogEntry[]) : [];
  }

  async append(scope: SyncLogScope, entry: SyncLogEntry, generation: number): Promise<void> {
    return this.withLock(async () => {
      const entries = await this.get(scope);
      if (generation !== this.generation) return;
      await browser.storage.local.set({
        [this.getStorageKey(scope)]: [entry, ...entries].slice(0, SyncLog.MAX_ENTRIES),
      });
    });
  }

  async clear(): Promise<void> {
    this.generation++;
    return this.withLock(async () => {
      const stored = await browser.storage.local.get(null);
      const keys = Object.keys(stored).filter(key => key.startsWith(SyncLog.STORAGE_KEY_PREFIX));
      if (keys.length > 0) await browser.storage.local.remove(keys);
    });
  }

  // Each write replaces the whole list, so overlapping read-modify-writes would drop entries.
  private withLock(fn: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private getStorageKey(scope: SyncLogScope): string {
    return `${SyncLog.STORAGE_KEY_PREFIX}${scope.network}:${scope.accountIndex}`;
  }
}

export const syncLog = new SyncLog();
