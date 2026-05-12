import * as bitcoin from 'bitcoinjs-lib';

const HEX_RE = /^[0-9a-f]+$/i;

export function parseMerkleRoot(headerHex: string): string {
  if (headerHex.length !== 160) {
    throw new RangeError(`Invalid header hex length: expected 160, got ${headerHex.length}`);
  }
  // 80-byte header: merkle_root occupies bytes 36-67 = hex chars 72-135
  return headerHex.slice(72, 136);
}

export function verifyMerkleProof(txid: string, pos: number, merkle: string[], merkleRoot: string): boolean {
  if (txid.length !== 64 || !HEX_RE.test(txid)) throw new TypeError('Invalid txid: must be 64 hex chars');
  if (merkleRoot.length !== 64 || !HEX_RE.test(merkleRoot))
    throw new TypeError('Invalid merkleRoot: must be 64 hex chars');
  for (const sib of merkle) {
    if (sib.length !== 64 || !HEX_RE.test(sib)) throw new TypeError('Invalid merkle sibling: must be 64 hex chars');
  }

  // Electrum returns txid and merkle siblings in display (reversed) byte order.
  // The merkle_root in the raw header is in internal byte order.
  let hash = Buffer.from(txid, 'hex').reverse();
  let p = pos;
  for (const sibling of merkle) {
    const siblingBuf = Buffer.from(sibling, 'hex').reverse();
    const pair = p % 2 === 0 ? Buffer.concat([hash, siblingBuf]) : Buffer.concat([siblingBuf, hash]);
    hash = Buffer.from(bitcoin.crypto.hash256(pair)) as Buffer<ArrayBuffer>;
    p = Math.floor(p / 2);
  }
  return hash.toString('hex') === merkleRoot;
}
