import type { ElectrumTransaction } from '../types/electrum';

const MAX_BTC_SUPPLY = 21_000_000;

export function assertElectrumTransaction(value: unknown): asserts value is ElectrumTransaction {
  if (!isObject(value)) throw new Error('Electrum response: expected object');
  const v = value;
  if (typeof v.txid !== 'string' || v.txid.length === 0) throw new Error('Electrum response: missing txid');
  if (typeof v.hex !== 'string') throw new Error('Electrum response: missing hex');
  if (typeof v.version !== 'number') throw new Error('Electrum response: invalid version');
  if (typeof v.locktime !== 'number') throw new Error('Electrum response: invalid locktime');
  if (!Array.isArray(v.vin)) throw new Error('Electrum response: vin must be array');
  if (!Array.isArray(v.vout)) throw new Error('Electrum response: vout must be array');
  v.vin.forEach((entry, i) => assertVinEntry(entry, i));
  v.vout.forEach((entry, i) => assertVoutEntry(entry, i));
}

function assertVinEntry(entry: unknown, index: number): void {
  if (!isObject(entry)) throw new Error(`Electrum response: vin[${index}] not object`);
  if (entry.txid !== undefined && typeof entry.txid !== 'string') {
    throw new Error(`Electrum response: vin[${index}].txid invalid`);
  }
  if (entry.vout !== undefined && typeof entry.vout !== 'number') {
    throw new Error(`Electrum response: vin[${index}].vout invalid`);
  }
  if (entry.value !== undefined) {
    const num = Number(entry.value);
    if (!Number.isFinite(num) || num < 0 || num > MAX_BTC_SUPPLY) {
      throw new Error(`Electrum response: vin[${index}].value out of range`);
    }
  }
}

function assertVoutEntry(entry: unknown, index: number): void {
  if (!isObject(entry)) throw new Error(`Electrum response: vout[${index}] not object`);
  const num = Number(entry.value);
  if (!Number.isFinite(num) || num < 0 || num > MAX_BTC_SUPPLY) {
    throw new Error(`Electrum response: vout[${index}].value out of range`);
  }
  if (entry.n !== undefined && typeof entry.n !== 'number') {
    throw new Error(`Electrum response: vout[${index}].n invalid`);
  }
  if (entry.scriptPubKey !== undefined && !isObject(entry.scriptPubKey)) {
    throw new Error(`Electrum response: vout[${index}].scriptPubKey invalid`);
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
