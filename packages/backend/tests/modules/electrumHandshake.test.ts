import {
  CHAIN_CHECKPOINTS,
  ELECTRUM_CLIENT_NAME,
  ELECTRUM_PROTOCOL_VERSION,
  blockHashFromHeader,
  isCheckpointHeader,
} from '../../src/modules/electrumHandshake';
import { Network } from '../../src/types/electrum';

const MAINNET_500000_HEADER =
  '000000201929eb850a74427d0440cf6b518308837566cd6d0662790000000000000000001f6231ed3de07345b607ec2a39b2d01bec2fe10dfb7f516ba4958a42691c95316d0a385a459600185599fc5c';
const TESTNET4_CHECKPOINT_HEADER =
  '0020b42b030216aa3bfeb2cffb069ffe3a9b0de3db50c75112279e4f1200000000000000456d7ffa5b03f0e8a4a2e10c296a2d140128e32728886aa304135e8d1cd1d0caeac2c06604fa54195ec4d06c';
// Same height, different chain: the BTC header with its prev-hash swapped out.
const BCH_500000_HEADER =
  '00000020e8a1b1c07e5b1c8f0e8f2c7e2a3d4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c1f6231ed3de07345b607ec2a39b2d01bec2fe10dfb7f516ba4958a42691c95316d0a385a459600185599fc5c';

describe('blockHashFromHeader', () => {
  it('derives the canonical block hash from an 80-byte header', () => {
    expect(blockHashFromHeader(MAINNET_500000_HEADER)).toBe(CHAIN_CHECKPOINTS[Network.Mainnet].hash);
  });

  it('rejects a header that is not 160 hex chars', () => {
    expect(() => blockHashFromHeader('00'.repeat(79))).toThrow(RangeError);
  });
});

describe('isCheckpointHeader', () => {
  it('accepts the real header for the active network checkpoint', () => {
    expect(isCheckpointHeader(MAINNET_500000_HEADER, Network.Mainnet)).toBe(true);
    expect(isCheckpointHeader(TESTNET4_CHECKPOINT_HEADER, Network.Testnet)).toBe(true);
  });

  // Bitcoin and Bitcoin Cash share every block up to 478,559, so the checkpoint sits past the fork.
  it('rejects a same-height header from a different chain', () => {
    expect(isCheckpointHeader(BCH_500000_HEADER, Network.Mainnet)).toBe(false);
  });

  it('rejects a header belonging to another network', () => {
    expect(isCheckpointHeader(TESTNET4_CHECKPOINT_HEADER, Network.Mainnet)).toBe(false);
    expect(isCheckpointHeader(MAINNET_500000_HEADER, Network.Testnet)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(isCheckpointHeader('', Network.Mainnet)).toBe(false);
    expect(isCheckpointHeader('zz'.repeat(80), Network.Mainnet)).toBe(false);
  });
});

describe('handshake identity', () => {
  it('uses a generic client name so servers cannot fingerprint the wallet', () => {
    expect(ELECTRUM_CLIENT_NAME).not.toMatch(/chui/i);
    expect(ELECTRUM_PROTOCOL_VERSION).toBe('1.4');
  });

  it('defines a checkpoint for every supported network', () => {
    for (const network of Object.values(Network)) {
      expect(CHAIN_CHECKPOINTS[network].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(CHAIN_CHECKPOINTS[network].height).toBeGreaterThanOrEqual(0);
    }
  });
});
