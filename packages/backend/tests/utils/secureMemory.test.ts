import { Buffer } from 'buffer';
import { zeroBuffer } from '../../src/utils/secureMemory';

describe('zeroBuffer', () => {
  it('overwrites every byte with zero', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    zeroBuffer(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0]);
  });

  it('mutates the same Buffer reference', () => {
    const buf = Buffer.from('secret', 'utf8');
    const ref = buf;
    zeroBuffer(buf);
    expect(ref).toBe(buf);
    expect(buf.every(b => b === 0)).toBe(true);
  });

  it('is a no-op on null', () => {
    expect(() => zeroBuffer(null)).not.toThrow();
  });

  it('is a no-op on undefined', () => {
    expect(() => zeroBuffer(undefined)).not.toThrow();
  });

  it('is a no-op on a zero-length buffer', () => {
    const buf = Buffer.alloc(0);
    expect(() => zeroBuffer(buf)).not.toThrow();
    expect(buf.length).toBe(0);
  });
});
