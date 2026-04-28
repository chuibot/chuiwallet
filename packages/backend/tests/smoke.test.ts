import { resetChromeStorage, seedLocal, getStorageSnapshot } from './helpers/chromeMock';

describe('test infrastructure', () => {
  beforeEach(() => resetChromeStorage());

  it('exposes chrome global', () => {
    expect(typeof chrome).toBe('object');
    expect(typeof chrome.storage.local.get).toBe('function');
  });

  it('exposes browser global (webextension-polyfill compat)', () => {
    expect(typeof (globalThis as { browser?: unknown }).browser).toBe('object');
  });

  it('chrome.storage.local.get supports promise + callback styles', async () => {
    seedLocal({ foo: 'bar' });
    const promiseResult = await chrome.storage.local.get('foo');
    expect(promiseResult).toEqual({ foo: 'bar' });

    const cbResult = await new Promise<Record<string, unknown>>(resolve => {
      chrome.storage.local.get('foo', resolve);
    });
    expect(cbResult).toEqual({ foo: 'bar' });
  });

  it('chrome.storage.local.set persists', async () => {
    await chrome.storage.local.set({ a: 1, b: 2 });
    expect(getStorageSnapshot('local')).toEqual({ a: 1, b: 2 });
  });

  it('chrome.storage.local.remove deletes keys', async () => {
    seedLocal({ a: 1, b: 2 });
    await chrome.storage.local.remove(['a']);
    expect(getStorageSnapshot('local')).toEqual({ b: 2 });
  });

  it('exposes Web Crypto', () => {
    expect(typeof crypto.subtle).toBe('object');
  });

  it('exposes fetch', () => {
    expect(typeof fetch).toBe('function');
  });

  it('exposes WebSocket', () => {
    expect(typeof WebSocket).toBe('function');
  });

  it('webextension-polyfill default export forwards to global browser', async () => {
    const { default: browser } = await import('webextension-polyfill');
    seedLocal({ x: 'y' });
    const r = await browser.storage.local.get('x');
    expect(r).toEqual({ x: 'y' });
  });
});
