import * as bitcoin from 'bitcoinjs-lib';

export function parseMerkleRoot(headerHex: string): string {
  // 80-byte header: merkle_root occupies bytes 36-67 = hex chars 72-135
  return headerHex.slice(72, 136);
}

export function verifyMerkleProof(txid: string, pos: number, merkle: string[], merkleRoot: string): boolean {
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
