import { selectUtxo, type SpendableUtxo } from '../../src/modules/utxoSelection';
import type { FeeSizer } from '../../src/modules/feeService';
import { ScriptType } from '../../src/types/wallet';
import { ChangeType } from '../../src/types/cache';

const mkUtxo = (value: number, idx: number): SpendableUtxo => ({
  txid: 'tx' + idx.toString().padStart(2, '0').repeat(32).slice(0, 62),
  vout: 0,
  value,
  height: 800_000 + idx,
  confirmations: 6,
  address: `bc1q${idx}`,
  index: idx,
  chain: ChangeType.External,
  scriptType: ScriptType.P2WPKH,
});

const flatFee =
  (sats: number): FeeSizer =>
  () =>
    sats;
const sizeAwareFee =
  (perInputSats: number): FeeSizer =>
  (count, includeChange) =>
    perInputSats * count + (includeChange ? 50 : 0);

describe('selectUtxo', () => {
  it('throws "Insufficient funds" with zero utxos', () => {
    expect(() => selectUtxo([], 1000, flatFee(100), 330)).toThrow('Insufficient funds');
  });

  it('throws "Insufficient funds" when total < target+fee', () => {
    const u = [mkUtxo(500, 0)];
    expect(() => selectUtxo(u, 1000, flatFee(100), 330)).toThrow('Insufficient funds');
  });

  it('selects the largest utxo first (greedy)', () => {
    const u = [mkUtxo(1000, 0), mkUtxo(5000, 1), mkUtxo(2000, 2)];
    const r = selectUtxo(u, 4000, flatFee(100), 330);
    expect(r.inputs).toHaveLength(1);
    expect(r.inputs[0].value).toBe(5000);
    expect(r.fee).toBe(100);
    expect(r.change).toBe(900);
  });

  it('extends selection until target+fee is reached', () => {
    const u = [mkUtxo(2000, 0), mkUtxo(2000, 1), mkUtxo(2000, 2)];
    const r = selectUtxo(u, 5000, sizeAwareFee(50), 330);
    expect(r.inputs.length).toBe(3);
    expect(r.fee).toBe(50 * 3 + 50);
    expect(r.change).toBe(2000 + 2000 + 2000 - 5000 - r.fee);
  });

  it('drops change when it would be dust by re-pricing without change output', () => {
    const u = [mkUtxo(1100, 0)];
    const r = selectUtxo(u, 1000, sizeAwareFee(20), 100);
    expect(r.change).toBe(0);
    expect(r.fee).toBeLessThanOrEqual(100);
  });

  it('keeps change above the dust threshold', () => {
    const u = [mkUtxo(2000, 0)];
    const r = selectUtxo(u, 1000, sizeAwareFee(50), 200);
    expect(r.change).toBeGreaterThanOrEqual(200);
  });

  it('returns positive change when the change output stays above dust', () => {
    const u = [mkUtxo(1200, 0)];
    const r = selectUtxo(u, 1000, sizeAwareFee(50), 100);
    expect(r.fee).toBe(100);
    expect(r.change).toBe(100);
  });
});
