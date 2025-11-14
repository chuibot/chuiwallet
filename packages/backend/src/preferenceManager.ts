import browser from 'webextension-polyfill';
import { Network } from './types/electrum';

export interface Preferences {
  gapLimitReceive: number;
  gapLimitChange: number;
  locale: string;
  fiatCurrency: string;
  activeAccountIndex: number;
  activeNetwork: Network;
}

export const defaultPreferences: Preferences = {
  gapLimitReceive: 500,
  gapLimitChange: 20,
  locale: 'en',
  fiatCurrency: 'USD',
  activeAccountIndex: -1,
  activeNetwork: Network.Mainnet,
};

const STORAGE_KEY = 'preferences';

export class PreferenceManager {
  private preferences: Preferences | undefined;

  public async init(): Promise<void> {
    if (this.preferences) return;
    this.preferences = await this.load();
  }

  public get(): Preferences {
    if (!this.preferences) {
      throw new Error('Preference manager not initialised');
    }

    return this.preferences;
  }

  /**
   * Update one or more preference fields, persist the new object,
   * and return the updated preferences.
   */
  public async update(updates: Partial<Preferences>): Promise<Preferences> {
    const current = this.get();
    this.preferences = { ...current, ...updates };
    await this.save(this.preferences);
    return this.preferences;
  }

  /**
   * Load preferences from chrome.storage.local.
   * If none are stored yet, write the defaults back to storage.
   */
  private async load(): Promise<Preferences> {
    const result = await browser.storage.local.get(STORAGE_KEY); // Direct await on the Promise

    if (result[STORAGE_KEY] === undefined) {
      // If no persisted value, save the defaults for next time
      await this.save(defaultPreferences);
      return defaultPreferences;
    }

    return result[STORAGE_KEY] as Preferences;
  }

  /**
   * Save the given preferences object to chrome.storage.local.
   */
  private async save(preferences: Preferences): Promise<void> {
    return await browser.storage.local.set({ [STORAGE_KEY]: preferences });
  }
}

export const preferenceManager = new PreferenceManager();
