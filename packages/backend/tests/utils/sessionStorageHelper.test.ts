import { resetChromeStorage } from '../helpers/chromeMock';
import {
  SESSION_PASSWORD_KEY,
  deleteSessionPassword,
  getSessionPassword,
  setSessionPassword,
} from '../../src/utils/sessionStorageHelper';

describe('sessionStorageHelper', () => {
  beforeEach(() => resetChromeStorage());

  it('round-trips a password value', async () => {
    await setSessionPassword('hunter2');
    expect(await getSessionPassword()).toBe('hunter2');
  });

  it('returns null when no password is stored', async () => {
    expect(await getSessionPassword()).toBeNull();
  });

  it('stores under the expected SESSION_PASSWORD_KEY', async () => {
    await setSessionPassword('pw');
    const raw = await chrome.storage.session.get(SESSION_PASSWORD_KEY);
    expect(raw[SESSION_PASSWORD_KEY]).toBeDefined();
    const entry = raw[SESSION_PASSWORD_KEY] as { value: string; expiry: number };
    expect(typeof entry.value).toBe('string');
    expect(typeof entry.expiry).toBe('number');
  });

  it('expires after the TTL and clears the entry', async () => {
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;

    try {
      await setSessionPassword('pw');
      expect(await getSessionPassword()).toBe('pw');
      now += 60 * 60 * 1000 + 1;
      expect(await getSessionPassword()).toBeNull();
      const raw = await chrome.storage.session.get(SESSION_PASSWORD_KEY);
      expect(raw[SESSION_PASSWORD_KEY]).toBeUndefined();
    } finally {
      Date.now = realNow;
    }
  });

  it('deleteSessionPassword removes the entry', async () => {
    await setSessionPassword('pw');
    await deleteSessionPassword();
    expect(await getSessionPassword()).toBeNull();
  });

  it('getSessionPassword returns null and logs when decryption fails', async () => {
    await chrome.storage.session.set({
      [SESSION_PASSWORD_KEY]: { value: 'not-real-ciphertext', expiry: Date.now() + 60_000 },
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getSessionPassword()).toBeNull();
    errSpy.mockRestore();
  });
});
