import type { ElectrumHistory, ElectrumMerkleProof, ElectrumTransaction, ElectrumUtxo } from '../types/electrum';

const MAX_BTC_SUPPLY = 21_000_000;
const MAX_SATS_SUPPLY = 21_000_000 * 100_000_000;

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

export function assertElectrumHistoryBatch(value: unknown): asserts value is ElectrumHistory[] {
  if (!Array.isArray(value)) throw new Error('Electrum response: history batch must be array');
  value.forEach((entries, batchIndex) => {
    if (!Array.isArray(entries)) {
      throw new Error(`Electrum response: history[${batchIndex}] must be array`);
    }
    entries.forEach((item, i) => {
      if (!isObject(item)) throw new Error(`Electrum response: history[${batchIndex}][${i}] not object`);
      if (typeof item.tx_hash !== 'string' || item.tx_hash.length === 0) {
        throw new Error(`Electrum response: history[${batchIndex}][${i}].tx_hash invalid`);
      }
      if (typeof item.height !== 'number' || !Number.isFinite(item.height)) {
        throw new Error(`Electrum response: history[${batchIndex}][${i}].height invalid`);
      }
      if (item.fee !== undefined && (typeof item.fee !== 'number' || item.fee < 0)) {
        throw new Error(`Electrum response: history[${batchIndex}][${i}].fee invalid`);
      }
    });
  });
}

export function assertElectrumUtxoBatch(value: unknown): asserts value is ElectrumUtxo[][] {
  if (!Array.isArray(value)) throw new Error('Electrum response: utxo batch must be array');
  value.forEach((entries, batchIndex) => {
    if (!Array.isArray(entries)) {
      throw new Error(`Electrum response: utxo[${batchIndex}] must be array`);
    }
    entries.forEach((item, i) => {
      if (!isObject(item)) throw new Error(`Electrum response: utxo[${batchIndex}][${i}] not object`);
      if (typeof item.tx_hash !== 'string' || item.tx_hash.length === 0) {
        throw new Error(`Electrum response: utxo[${batchIndex}][${i}].tx_hash invalid`);
      }
      if (typeof item.tx_pos !== 'number' || !Number.isInteger(item.tx_pos) || item.tx_pos < 0) {
        throw new Error(`Electrum response: utxo[${batchIndex}][${i}].tx_pos invalid`);
      }
      if (typeof item.height !== 'number' || !Number.isFinite(item.height)) {
        throw new Error(`Electrum response: utxo[${batchIndex}][${i}].height invalid`);
      }
      if (
        typeof item.value !== 'number' ||
        !Number.isFinite(item.value) ||
        item.value < 0 ||
        item.value > MAX_SATS_SUPPLY
      ) {
        throw new Error(`Electrum response: utxo[${batchIndex}][${i}].value out of range`);
      }
    });
  });
}

export function assertElectrumTipHeader(value: unknown): asserts value is { height: number } {
  if (!isObject(value)) throw new Error('Electrum response: header must be object');
  if (typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height < 0) {
    throw new Error('Electrum response: header.height invalid');
  }
}

export function assertBlockHeader(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{160}$/i.test(value)) {
    throw new Error('Electrum response: block header must be 160-char hex string');
  }
}

export function assertElectrumMerkleProof(value: unknown): asserts value is ElectrumMerkleProof {
  if (!isObject(value)) throw new Error('Electrum response: merkle proof must be object');
  if (typeof value.block_height !== 'number' || !Number.isFinite(value.block_height) || value.block_height < 0) {
    throw new Error('Electrum response: merkle proof block_height invalid');
  }
  if (typeof value.pos !== 'number' || !Number.isFinite(value.pos) || value.pos < 0) {
    throw new Error('Electrum response: merkle proof pos invalid');
  }
  if (!Array.isArray(value.merkle)) throw new Error('Electrum response: merkle must be array');
  for (let i = 0; i < value.merkle.length; i++) {
    if (typeof value.merkle[i] !== 'string' || !/^[0-9a-f]{64}$/i.test(value.merkle[i] as string)) {
      throw new Error(`Electrum response: merkle[${i}] must be 64-char hex`);
    }
  }
}
