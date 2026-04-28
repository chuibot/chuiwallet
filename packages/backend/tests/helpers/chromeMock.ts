type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void;

class StorageArea {
  private store = new Map<string, unknown>();
  private listeners: Listener[] = [];
  constructor(public readonly name: 'local' | 'session' | 'sync' | 'managed') {}

  private resolveKeys(keys: unknown): { keyArr: string[]; defaults: Record<string, unknown> } {
    if (keys === null || keys === undefined) {
      return { keyArr: Array.from(this.store.keys()), defaults: {} };
    }
    if (typeof keys === 'string') return { keyArr: [keys], defaults: {} };
    if (Array.isArray(keys)) return { keyArr: keys.map(String), defaults: {} };
    if (typeof keys === 'object') {
      const obj = keys as Record<string, unknown>;
      return { keyArr: Object.keys(obj), defaults: obj };
    }
    return { keyArr: [], defaults: {} };
  }

  getSync(keys: unknown): Record<string, unknown> {
    const { keyArr, defaults } = this.resolveKeys(keys);
    const result: Record<string, unknown> = {};
    for (const k of keyArr) {
      if (this.store.has(k)) result[k] = this.store.get(k);
      else if (k in defaults) result[k] = defaults[k];
    }
    return result;
  }

  setSync(items: Record<string, unknown>): void {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.store.get(k), newValue: v };
      this.store.set(k, v);
    }
    for (const l of this.listeners) l(changes, this.name);
  }

  removeSync(keys: string | string[]): void {
    const arr = Array.isArray(keys) ? keys : [keys];
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of arr) {
      if (this.store.has(k)) {
        changes[k] = { oldValue: this.store.get(k), newValue: undefined };
        this.store.delete(k);
      }
    }
    for (const l of this.listeners) l(changes, this.name);
  }

  clearSync(): void {
    this.store.clear();
  }

  addListener(l: Listener): void {
    this.listeners.push(l);
  }

  removeListener(l: Listener): void {
    this.listeners = this.listeners.filter(x => x !== l);
  }

  reset(): void {
    this.store.clear();
    this.listeners = [];
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }
}

const local = new StorageArea('local');
const session = new StorageArea('session');
const sync = new StorageArea('sync');

function wrapArea(area: StorageArea) {
  return {
    get: (keys?: unknown, cb?: (items: Record<string, unknown>) => void) => {
      const result = area.getSync(keys);
      if (typeof cb === 'function') {
        cb(result);
        return undefined;
      }
      return Promise.resolve(result);
    },
    set: (items: Record<string, unknown>, cb?: () => void) => {
      area.setSync(items);
      if (typeof cb === 'function') {
        cb();
        return undefined;
      }
      return Promise.resolve();
    },
    remove: (keys: string | string[], cb?: () => void) => {
      area.removeSync(keys);
      if (typeof cb === 'function') {
        cb();
        return undefined;
      }
      return Promise.resolve();
    },
    clear: (cb?: () => void) => {
      area.clearSync();
      if (typeof cb === 'function') {
        cb();
        return undefined;
      }
      return Promise.resolve();
    },
    setAccessLevel: () => Promise.resolve(),
    onChanged: {
      addListener: (l: Listener) => area.addListener(l),
      removeListener: (l: Listener) => area.removeListener(l),
    },
  };
}

const onChangedListeners: Listener[] = [];

export function installChromeMock(): void {
  const chromeApi = {
    storage: {
      local: wrapArea(local),
      session: wrapArea(session),
      sync: wrapArea(sync),
      onChanged: {
        addListener: (l: Listener) => {
          onChangedListeners.push(l);
        },
        removeListener: (l: Listener) => {
          const idx = onChangedListeners.indexOf(l);
          if (idx >= 0) onChangedListeners.splice(idx, 1);
        },
      },
    },
    runtime: {
      id: 'test-extension',
      lastError: undefined,
    },
  };
  (globalThis as unknown as { chrome: typeof chromeApi }).chrome = chromeApi;
  (globalThis as unknown as { browser?: typeof chromeApi }).browser = chromeApi;
}

export function resetChromeStorage(): void {
  local.reset();
  session.reset();
  sync.reset();
}

export function getStorageSnapshot(area: 'local' | 'session' | 'sync' = 'local'): Record<string, unknown> {
  if (area === 'local') return local.snapshot();
  if (area === 'session') return session.snapshot();
  return sync.snapshot();
}

export function seedLocal(items: Record<string, unknown>): void {
  local.setSync(items);
}

export function seedSession(items: Record<string, unknown>): void {
  session.setSync(items);
}
