import * as bitcoin from 'bitcoinjs-lib';
import { Network } from '../types/electrum';

const HEADER_HEX_LENGTH = 160;
const HEX_RE = /^[0-9a-f]+$/i;

/** Generic on purpose: a product-specific name would let every server fingerprint this wallet. */
export const ELECTRUM_CLIENT_NAME = 'electrum-client';
export const ELECTRUM_PROTOCOL_VERSION = '1.4';

export type ChainCheckpoint = { height: number; hash: string };

/**
 * Block a server must be able to serve, and whose hash identifies the chain it is on.
 * Mainnet sits past height 478,559 because Bitcoin and Bitcoin Cash share every block below
 * it. Neither is genesis: every node answers genesis from a built-in constant, so it proves
 * nothing about whether the server can actually serve chain data.
 */
export const CHAIN_CHECKPOINTS: Readonly<Record<Network, ChainCheckpoint>> = {
  [Network.Mainnet]: {
    height: 500_000,
    hash: '00000000000000000024fb37364cbf81fd49cc2d51c09c75c35433c3a1945d04',
  },
  [Network.Testnet]: {
    height: 40_000,
    hash: '000000000000000c1a1fad82b0e133f4772802b6dff7a95990580ae2e15c634f',
  },
};

export function blockHashFromHeader(headerHex: string): string {
  if (headerHex.length !== HEADER_HEX_LENGTH) {
    throw new RangeError(`Invalid header hex length: expected ${HEADER_HEX_LENGTH}, got ${headerHex.length}`);
  }
  if (!HEX_RE.test(headerHex)) {
    throw new RangeError('Invalid header hex: expected hexadecimal characters');
  }

  const hash = bitcoin.crypto.hash256(Buffer.from(headerHex, 'hex'));
  return Buffer.from(hash).reverse().toString('hex');
}

export function isCheckpointHeader(headerHex: string, network: Network): boolean {
  try {
    return blockHashFromHeader(headerHex) === CHAIN_CHECKPOINTS[network].hash;
  } catch {
    return false;
  }
}
