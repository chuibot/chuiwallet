export type Listener<T> = (event: T) => void;

export interface Emitter<T> {
  on(listener: Listener<T>): () => void; // returns unsubscribe
  off(listener: Listener<T>): void;
  once(listener: Listener<T>): () => void;
  emit(event: T): void;
  clear(): void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<Listener<T>>();

  function on(listener: Listener<T>): () => void {
    listeners.add(listener);
    return () => off(listener);
  }

  function off(listener: Listener<T>): void {
    listeners.delete(listener);
  }

  function once(listener: Listener<T>): () => void {
    const wrap: Listener<T> = event => {
      off(wrap);
      listener(event);
    };
    return on(wrap);
  }

  function emit(event: T): void {
    // copy to avoid mutation during iteration edge-cases
    for (const l of Array.from(listeners)) l(event);
  }

  function clear(): void {
    listeners.clear();
  }

  return { on, off, once, emit, clear };
}
