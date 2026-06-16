import { ethers } from 'ethers';
import { resetChromeStorage } from '../helpers/chromeMock';
import { EthereumAdapter, parseIndexerTransactions } from '../../src/adapters/EthereumAdapter';
import { ChainType } from '../../src/adapters/IChainAdapter';
import { ERC20_TOKEN_DEFINITIONS, getErc20ContractAddress } from '../../src/adapters/erc20TokenDefinitions';
import { Network } from '../../src/types/electrum';
import { preferenceManager, defaultPreferences } from '../../src/preferenceManager';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('ERC20_TOKEN_DEFINITIONS', () => {
  it('contains USDT with mainnet + testnet contracts', () => {
    expect(ERC20_TOKEN_DEFINITIONS.USDT).toBeDefined();
    expect(ERC20_TOKEN_DEFINITIONS.USDT.contracts[Network.Mainnet]).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(ERC20_TOKEN_DEFINITIONS.USDT.contracts[Network.Testnet]).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

describe('getErc20ContractAddress', () => {
  it('resolves a known token by symbol+network', () => {
    expect(getErc20ContractAddress('USDT', Network.Mainnet)).toBe(
      ERC20_TOKEN_DEFINITIONS.USDT.contracts[Network.Mainnet],
    );
  });
  it('returns undefined for unknown tokens', () => {
    expect(getErc20ContractAddress('UNKNOWN', Network.Mainnet)).toBeUndefined();
  });
});

describe('parseIndexerTransactions — untrusted response validation', () => {
  const validTx = {
    hash: '0xabc',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    gasUsed: '21000',
    gasPrice: '1000000000',
    timeStamp: '1700000000',
    confirmations: '10',
    isError: '0',
  };

  it('parses a well-formed response', () => {
    const txs = parseIndexerTransactions({ status: '1', result: [validTx] });
    expect(txs).toHaveLength(1);
    expect(txs[0].hash).toBe('0xabc');
    expect(txs[0].amount).toBe(1);
    expect(txs[0].confirmations).toBe(10);
    expect(txs[0].status).toBe('confirmed');
  });

  it('returns [] for a non-object, wrong-status, or non-array response', () => {
    expect(parseIndexerTransactions(null)).toEqual([]);
    expect(parseIndexerTransactions('garbage')).toEqual([]);
    expect(parseIndexerTransactions(['x'])).toEqual([]);
    expect(parseIndexerTransactions({ status: '0', result: [validTx] })).toEqual([]);
    expect(parseIndexerTransactions({ status: '1', result: 'nope' })).toEqual([]);
  });

  it('drops entries with missing or non-integer numeric fields (no NaN leaks through)', () => {
    const result = [
      { ...validTx, value: undefined },
      { ...validTx, gasUsed: 'abc' },
      { ...validTx, confirmations: '1.5' },
      { ...validTx, timeStamp: 'not-a-number' },
      validTx,
    ];
    const txs = parseIndexerTransactions({ status: '1', result });
    expect(txs).toHaveLength(1);
    expect(txs[0].hash).toBe('0xabc');
    expect(Number.isNaN(txs[0].timestamp)).toBe(false);
    expect(Number.isNaN(txs[0].confirmations)).toBe(false);
  });

  it('drops token rows with malformed or oversized tokenDecimal', () => {
    const result = [
      { ...validTx, tokenDecimal: '1e309' },
      { ...validTx, tokenDecimal: '999' },
      { ...validTx, tokenDecimal: '6' },
    ];
    const txs = parseIndexerTransactions({ status: '1', result }, '0xtoken');
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(parseFloat(ethers.formatUnits('1000000000000000000', 6)));
  });

  it('defaults to 18 decimals when tokenDecimal is absent on a token row', () => {
    const txs = parseIndexerTransactions({ status: '1', result: [validTx] }, '0xtoken');
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(parseFloat(ethers.formatUnits('1000000000000000000', 18)));
  });
});

describe('EthereumAdapter — metadata + key derivation', () => {
  beforeEach(async () => {
    resetChromeStorage();
    Object.defineProperty(preferenceManager, 'preferences', {
      value: { ...defaultPreferences },
      writable: true,
      configurable: true,
    });
  });

  it('exposes ETH metadata', () => {
    const a = new EthereumAdapter();
    expect(a.chainType).toBe(ChainType.Ethereum);
    expect(a.symbol).toBe('ETH');
    expect(a.decimals).toBe(18);
  });

  it('initWithMnemonic + deriveAddress yield BIP-44 addresses for the canonical test mnemonic', () => {
    const a = new EthereumAdapter();
    a.initWithMnemonic(TEST_MNEMONIC, 0);
    const a0 = a.deriveAddress(0, 0);
    const a1 = a.deriveAddress(0, 1);
    expect(a0).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(a1).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(a0).not.toEqual(a1);
    expect(a0.toLowerCase()).toBe('0x9858effd232b4033e47d90003d41ec34ecaeda94');
  });

  it('deriveAddress throws when initWithMnemonic was not called', () => {
    const a = new EthereumAdapter();
    expect(() => a.deriveAddress(0, 0)).toThrow(/not initialized/);
  });

  it('clearKeys() drops the in-memory hd node', () => {
    const a = new EthereumAdapter();
    a.initWithMnemonic(TEST_MNEMONIC, 0);
    a.clearKeys();
    expect(() => a.deriveAddress(0, 0)).toThrow(/not initialized/);
  });

  it('getReceivingAddress uses the active address index seeded by initWithMnemonic', () => {
    const a = new EthereumAdapter();
    a.initWithMnemonic(TEST_MNEMONIC, 3);
    expect(a.getReceivingAddress()).toBe(a.deriveAddress(0, 3));
  });

  it('disconnect() is idempotent and does not throw', async () => {
    const a = new EthereumAdapter();
    await a.disconnect();
    await a.disconnect();
  });
});
