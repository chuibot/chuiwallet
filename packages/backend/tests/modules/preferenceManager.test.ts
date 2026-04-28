import { resetChromeStorage } from '../helpers/chromeMock';
import { PreferenceManager, defaultPreferences } from '../../src/preferenceManager';
import { Network } from '../../src/types/electrum';

describe('PreferenceManager', () => {
  let mgr: PreferenceManager;

  beforeEach(() => {
    resetChromeStorage();
    mgr = new PreferenceManager();
  });

  it('throws if get() is called before init()', () => {
    expect(() => mgr.get()).toThrow('Preference manager not initialised');
  });

  it('persists defaults on first init when nothing stored', async () => {
    await mgr.init();
    expect(mgr.get()).toEqual(defaultPreferences);
    const stored = await chrome.storage.local.get('preferences');
    expect(stored.preferences).toEqual(defaultPreferences);
  });

  it('init() is idempotent and skips re-loading', async () => {
    await mgr.init();
    await mgr.update({ fiatCurrency: 'EUR' });
    await mgr.init();
    expect(mgr.get().fiatCurrency).toBe('EUR');
  });

  it('update() merges partial fields and persists', async () => {
    await mgr.init();
    const next = await mgr.update({ fiatCurrency: 'SGD', activeNetwork: Network.Testnet });
    expect(next.fiatCurrency).toBe('SGD');
    expect(next.activeNetwork).toBe(Network.Testnet);

    const stored = await chrome.storage.local.get('preferences');
    expect((stored.preferences as { fiatCurrency: string }).fiatCurrency).toBe('SGD');
  });

  it('migrates stored prefs missing activeEvmNetwork to mirror activeNetwork', async () => {
    await chrome.storage.local.set({
      preferences: {
        ...defaultPreferences,
        activeNetwork: Network.Testnet,
        activeEvmNetwork: undefined,
      },
    });
    const fresh = new PreferenceManager();
    await fresh.init();
    expect(fresh.get().activeEvmNetwork).toBe(Network.Testnet);
    const stored = await chrome.storage.local.get('preferences');
    expect((stored.preferences as { activeEvmNetwork: Network }).activeEvmNetwork).toBe(Network.Testnet);
  });

  it('preserves stored activeEvmNetwork when set', async () => {
    await chrome.storage.local.set({
      preferences: { ...defaultPreferences, activeEvmNetwork: Network.Mainnet, activeNetwork: Network.Testnet },
    });
    const fresh = new PreferenceManager();
    await fresh.init();
    expect(fresh.get().activeEvmNetwork).toBe(Network.Mainnet);
    expect(fresh.get().activeNetwork).toBe(Network.Testnet);
  });

  it('default gap limits are 200 / 20', () => {
    expect(defaultPreferences.gapLimitReceive).toBe(200);
    expect(defaultPreferences.gapLimitChange).toBe(20);
  });
});
