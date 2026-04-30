import { computeForwardScanWindow } from '../../src/scanManager';

describe('computeForwardScanWindow', () => {
  it('returns gap+1 from a fresh wallet (no usage, nothing scanned)', () => {
    expect(computeForwardScanWindow(-1, 200, -1)).toBe(201);
  });

  it('returns 0 when scanned exactly to the gap boundary', () => {
    expect(computeForwardScanWindow(5, 20, 25)).toBe(0);
  });

  it('extends the window by exactly one when one new used index appears', () => {
    expect(computeForwardScanWindow(6, 20, 25)).toBe(1);
  });

  it('returns negative when scanned beyond the gap (caller treats <=0 as up-to-date)', () => {
    expect(computeForwardScanWindow(5, 20, 26)).toBe(-1);
  });

  it('clamps a negative highestUsed to 0', () => {
    expect(computeForwardScanWindow(-1, 20, 0)).toBe(20);
  });

  it('handles a small gap limit', () => {
    expect(computeForwardScanWindow(0, 1, 0)).toBe(1);
    expect(computeForwardScanWindow(0, 1, 1)).toBe(0);
  });
});
