import * as bitcoin from 'bitcoinjs-lib';
import { parseMerkleRoot, verifyMerkleProof } from '../../src/utils/merkle';

// Build a merkle root from two txids in internal byte order (the way Bitcoin does it)
function buildMerkleRoot(displayTx0: string, displayTx1: string): string {
  const a = Buffer.from(displayTx0, 'hex').reverse();
  const b = Buffer.from(displayTx1, 'hex').reverse();
  return bitcoin.crypto.hash256(Buffer.concat([a, b])).toString('hex');
}

const TX0 = 'aa'.repeat(32); // display order
const TX1 = 'bb'.repeat(32);
const MERKLE_ROOT_2TX = buildMerkleRoot(TX0, TX1);

describe('parseMerkleRoot', () => {
  it('extracts bytes 36-67 of the 80-byte header hex', () => {
    const merkleHex = 'cd'.repeat(32);
    const headerHex = '00'.repeat(36) + merkleHex + '00'.repeat(12);
    expect(parseMerkleRoot(headerHex)).toBe(merkleHex);
  });

  it('works with all-zero header', () => {
    expect(parseMerkleRoot('00'.repeat(80))).toBe('00'.repeat(32));
  });

  it('throws RangeError for wrong-length input', () => {
    expect(() => parseMerkleRoot('00'.repeat(79))).toThrow(RangeError);
    expect(() => parseMerkleRoot('00'.repeat(81))).toThrow(RangeError);
    expect(() => parseMerkleRoot('')).toThrow(RangeError);
  });
});

describe('verifyMerkleProof', () => {
  it('verifies tx0 (pos=0) in a two-transaction block', () => {
    expect(verifyMerkleProof(TX0, 0, [TX1], MERKLE_ROOT_2TX)).toBe(true);
  });

  it('verifies tx1 (pos=1) in a two-transaction block', () => {
    expect(verifyMerkleProof(TX1, 1, [TX0], MERKLE_ROOT_2TX)).toBe(true);
  });

  it('verifies a single-tx block (empty merkle branch)', () => {
    // Single tx: merkle_root = SHA256d(txid_internal) — but actually it's just txid_internal
    // For a single tx, the merkle_root IS the txid in internal byte order
    const txid = 'cc'.repeat(32);
    const internalRoot = Buffer.from(txid, 'hex').reverse().toString('hex');
    expect(verifyMerkleProof(txid, 0, [], internalRoot)).toBe(true);
  });

  it('rejects a wrong txid', () => {
    const wrongTx = 'ff'.repeat(32);
    expect(verifyMerkleProof(wrongTx, 0, [TX1], MERKLE_ROOT_2TX)).toBe(false);
  });

  it('rejects a wrong merkle root', () => {
    expect(verifyMerkleProof(TX0, 0, [TX1], 'dead'.repeat(16))).toBe(false);
  });

  it('rejects a wrong sibling', () => {
    const wrongSibling = 'ff'.repeat(32);
    expect(verifyMerkleProof(TX0, 0, [wrongSibling], MERKLE_ROOT_2TX)).toBe(false);
  });

  it('rejects correct txid at wrong position', () => {
    // TX0 is at pos=0, providing it at pos=1 with TX1 as sibling should fail
    expect(verifyMerkleProof(TX0, 1, [TX1], MERKLE_ROOT_2TX)).toBe(false);
  });

  it('verifies Bitcoin odd-tx-count duplication (3 txs, pos=2 uses itself as sibling)', () => {
    // Bitcoin duplicates the last tx when the row count is odd.
    // For [A, B, C]: level1 = [hash(A+B), hash(C+C)], root = hash(level1[0]+level1[1])
    const txs = ['aa', 'bb', 'cc'].map(b => b.repeat(32));
    const internals = txs.map(t => Buffer.from(t, 'hex').reverse());
    const level1 = [
      bitcoin.crypto.hash256(Buffer.concat([internals[0], internals[1]])),
      bitcoin.crypto.hash256(Buffer.concat([internals[2], internals[2]])), // C duplicated
    ];
    const root = bitcoin.crypto.hash256(Buffer.concat([level1[0], level1[1]])).toString('hex');

    // Electrum proof for C (pos=2): sibling[0]=C (display), sibling[1]=level1[0] (display = reversed)
    const sib0 = txs[2]; // C itself in display order
    const sib1Display = Buffer.from(level1[0]).reverse().toString('hex');
    expect(verifyMerkleProof(txs[2], 2, [sib0, sib1Display], root)).toBe(true);
  });

  it('verifies a three-level merkle tree (4 transactions)', () => {
    const txs = ['aa', 'bb', 'cc', 'dd'].map(b => b.repeat(32));
    const internals = txs.map(t => Buffer.from(t, 'hex').reverse());
    const level1 = [
      bitcoin.crypto.hash256(Buffer.concat([internals[0], internals[1]])),
      bitcoin.crypto.hash256(Buffer.concat([internals[2], internals[3]])),
    ];
    const root = bitcoin.crypto.hash256(Buffer.concat([level1[0], level1[1]])).toString('hex');

    // TX at pos=0: siblings are [display(tx1), display(level1[1])]
    const sib0 = txs[1];
    const sib1 = level1[1].toString('hex'); // sibling in internal order — reverse for display
    const sib1Display = Buffer.from(sib1, 'hex').reverse().toString('hex');

    expect(verifyMerkleProof(txs[0], 0, [sib0, sib1Display], root)).toBe(true);
  });
});
