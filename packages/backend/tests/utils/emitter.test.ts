import { createEmitter } from '../../src/utils/emitter';

describe('emitter', () => {
  it('emits to all subscribed listeners in order', () => {
    const e = createEmitter<number>();
    const a: number[] = [];
    const b: number[] = [];
    e.on(v => a.push(v));
    e.on(v => b.push(v));
    e.emit(1);
    e.emit(2);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  it('returns an unsubscribe function from on()', () => {
    const e = createEmitter<string>();
    const seen: string[] = [];
    const off = e.on(v => seen.push(v));
    e.emit('a');
    off();
    e.emit('b');
    expect(seen).toEqual(['a']);
  });

  it('off() removes a listener even if emitted again', () => {
    const e = createEmitter<number>();
    const seen: number[] = [];
    const fn = (v: number) => seen.push(v);
    e.on(fn);
    e.emit(1);
    e.off(fn);
    e.emit(2);
    expect(seen).toEqual([1]);
  });

  it('once() fires exactly one time', () => {
    const e = createEmitter<number>();
    const seen: number[] = [];
    e.once(v => seen.push(v));
    e.emit(10);
    e.emit(20);
    expect(seen).toEqual([10]);
  });

  it('once() unsubscribe (returned function) prevents firing entirely', () => {
    const e = createEmitter<number>();
    const seen: number[] = [];
    const off = e.once(v => seen.push(v));
    off();
    e.emit(99);
    expect(seen).toEqual([]);
  });

  it('clear() drops all listeners', () => {
    const e = createEmitter<number>();
    const seen: number[] = [];
    e.on(v => seen.push(v));
    e.on(v => seen.push(v + 100));
    e.clear();
    e.emit(1);
    expect(seen).toEqual([]);
  });

  it('handles a listener that subscribes during emit without throwing', () => {
    const e = createEmitter<number>();
    const seen: number[] = [];
    e.on(v => {
      seen.push(v);
      if (v === 1) e.on(x => seen.push(x * 10));
    });
    e.emit(1);
    e.emit(2);
    expect(seen).toEqual([1, 2, 20]);
  });
});
