import { resetChromeStorage } from '../helpers/chromeMock';
import { AccountManager } from '../../src/accountManager';
import { Network } from '../../src/types/electrum';
import type { Account } from '../../src/types/wallet';
import { ScriptType } from '../../src/types/wallet';

const makeAccount = (overrides: Partial<Account> = {}): Account => ({
  name: 'Account #1',
  index: 0,
  network: Network.Mainnet,
  xpub: 'xpub-mock-1',
  scriptType: ScriptType.P2WPKH,
  ...overrides,
});

describe('AccountManager', () => {
  let mgr: AccountManager;

  beforeEach(() => {
    resetChromeStorage();
    mgr = new AccountManager();
  });

  it('init() with no stored accounts yields empty list', async () => {
    await mgr.init();
    expect(mgr.accounts).toEqual([]);
    expect(mgr.activeAccountIndex).toBe(-1);
  });

  it('add() persists, sets active index, and returns it', async () => {
    await mgr.init();
    const idx = await mgr.add(makeAccount());
    expect(idx).toBe(0);
    expect(mgr.activeAccountIndex).toBe(0);

    const stored = await chrome.storage.local.get('accounts');
    expect((stored.accounts as Account[]).length).toBe(1);
  });

  it('getActiveAccount throws when no active', async () => {
    await mgr.init();
    expect(() => mgr.getActiveAccount()).toThrow('No active account');
  });

  it('getActiveAccount returns the indexed account', async () => {
    await mgr.init();
    await mgr.add(makeAccount({ name: 'A', index: 0 }));
    await mgr.add(makeAccount({ name: 'B', index: 1 }));
    expect(mgr.getActiveAccount().name).toBe('B');
  });

  it('init persists across instances via chrome.storage.local', async () => {
    const first = new AccountManager();
    await first.init();
    await first.add(makeAccount({ name: 'persist-me', index: 0 }));

    const second = new AccountManager();
    await second.init();
    expect(second.accounts).toHaveLength(1);
    expect(second.accounts[0].name).toBe('persist-me');
  });

  it('init dedupes by network:index:scriptType:xpub', async () => {
    await chrome.storage.local.set({
      accounts: [
        makeAccount({ index: 0, xpub: 'X' }),
        makeAccount({ index: 0, xpub: 'X' }),
        makeAccount({ index: 1, xpub: 'Y' }),
      ],
    });
    const fresh = new AccountManager();
    await fresh.init();
    expect(fresh.accounts).toHaveLength(2);
    const stored = await chrome.storage.local.get('accounts');
    expect((stored.accounts as Account[]).length).toBe(2);
  });

  it('remove() deletes by network+index and refreshes activeAccountIndex', async () => {
    await mgr.init();
    await mgr.add(makeAccount({ index: 0 }));
    await mgr.add(makeAccount({ index: 1 }));
    expect(mgr.activeAccountIndex).toBe(1);
    await mgr.remove({ network: Network.Mainnet, index: 0 });
    expect(mgr.accounts).toHaveLength(1);
    expect(mgr.accounts[0].index).toBe(1);
    expect(mgr.activeAccountIndex).toBe(0);
  });

  it('remove() of the active account leaves activeAccountIndex at -1', async () => {
    await mgr.init();
    await mgr.add(makeAccount({ index: 0 }));
    await mgr.remove({ network: Network.Mainnet, index: 0 });
    expect(mgr.accounts).toHaveLength(0);
    expect(mgr.activeAccountIndex).toBe(-1);
  });

  it('remove() preserves accounts on different networks', async () => {
    await mgr.init();
    await mgr.add(makeAccount({ index: 0, network: Network.Mainnet }));
    await mgr.add(makeAccount({ index: 0, network: Network.Testnet }));
    await mgr.remove({ network: Network.Mainnet, index: 0 });
    expect(mgr.accounts).toHaveLength(1);
    expect(mgr.accounts[0].network).toBe(Network.Testnet);
  });

  it('destroy() clears in-memory state and removes the storage key', async () => {
    await mgr.init();
    await mgr.add(makeAccount());
    await mgr.destroy();
    expect(mgr.accounts).toEqual([]);
    expect(mgr.activeAccountIndex).toBe(-1);
    const stored = await chrome.storage.local.get('accounts');
    expect(stored.accounts).toBeUndefined();
  });
});
