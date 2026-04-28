import { resetChromeStorage } from '../helpers/chromeMock';
import { EthereumAdapter } from '../../src/adapters/EthereumAdapter';
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
