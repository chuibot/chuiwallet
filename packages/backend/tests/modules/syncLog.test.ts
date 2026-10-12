import { resetChromeStorage } from '../helpers/chromeMock';
import { SyncLog, type SyncLogEntry } from '../../src/modules/syncLog';
import { Network } from '../../src/types/electrum';

const scope = { network: Network.Mainnet, accountIndex: 0 };

function entry(startedAt: number): SyncLogEntry {
  return { startedAt, finishedAt: startedAt + 1, status: 'completed' };
}

describe('SyncLog', () => {
  beforeEach(() => resetChromeStorage());

  it('returns entries newest first, capped at 20', async () => {
    const log = new SyncLog();
    for (let i = 0; i < 25; i++) await log.append(scope, entry(i), log.captureGeneration());

    const entries = await log.get(scope);

    expect(entries).toHaveLength(20);
    expect(entries[0].startedAt).toBe(24);
    expect(entries[19].startedAt).toBe(5);
  });

  it('keeps accounts and networks apart', async () => {
    const log = new SyncLog();
    await log.append(scope, entry(1), log.captureGeneration());

    expect(await log.get({ network: Network.Testnet, accountIndex: 0 })).toEqual([]);
    expect(await log.get({ network: Network.Mainnet, accountIndex: 1 })).toEqual([]);
  });

  it('clear() removes only sync logs', async () => {
    const log = new SyncLog();
    await chrome.storage.local.set({ keep_me: 'preserved' });
    await log.append(scope, entry(1), log.captureGeneration());

    await log.clear();

    const all = await chrome.storage.local.get(null);
    expect(all.keep_me).toBe('preserved');
    expect(await log.get(scope)).toEqual([]);
  });

  it('keeps both entries when two appends to one log overlap', async () => {
    const log = new SyncLog();
    const generation = log.captureGeneration();

    await Promise.all([log.append(scope, entry(1), generation), log.append(scope, entry(2), generation)]);

    expect((await log.get(scope)).map(e => e.startedAt)).toEqual([2, 1]);
  });

  it('drops an append captured before the last clear()', async () => {
    const log = new SyncLog();
    const generation = log.captureGeneration();
    await log.clear();

    await log.append(scope, entry(1), generation);
    expect(await log.get(scope)).toEqual([]);

    await log.append(scope, entry(2), log.captureGeneration());
    expect((await log.get(scope)).map(e => e.startedAt)).toEqual([2]);
  });

  it('drops an append still pending when clear() runs', async () => {
    const log = new SyncLog();
    const pending = log.append(scope, entry(1), log.captureGeneration());
    await log.clear();
    await pending;

    expect(await log.get(scope)).toEqual([]);
  });
});
