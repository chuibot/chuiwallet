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

  it('drops rows with oversized digit-only numeric fields without throwing', () => {
    const result = [
      { ...validTx, value: '1'.repeat(100) },
      { ...validTx, gasUsed: '9'.repeat(20) },
      { ...validTx, gasPrice: '9'.repeat(40) },
      { ...validTx, timeStamp: '9'.repeat(20) },
      { ...validTx, confirmations: '9'.repeat(20) },
      validTx,
    ];
    let txs: ReturnType<typeof parseIndexerTransactions> = [];
    expect(() => {
      txs = parseIndexerTransactions({ status: '1', result });
    }).not.toThrow();
    expect(txs).toHaveLength(1);
    expect(txs[0].hash).toBe('0xabc');
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

describe('EthereumAdapter — estimateMaxSend', () => {
  const GAS_LIMIT = '21000';
  const MAX_FEE_PER_GAS_WEI = '30000000000'; // 30 gwei
  const RESERVE_WEI = BigInt(GAS_LIMIT) * BigInt(MAX_FEE_PER_GAS_WEI);

  function adapterWithBalance(balanceWei: bigint, tokenBalance?: bigint): EthereumAdapter {
    const adapter = new EthereumAdapter();
    adapter.initWithMnemonic(TEST_MNEMONIC, 0);
    const provider = {
      getBalance: async () => balanceWei,
      call: async () => ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [tokenBalance ?? BigInt(0)]),
      getFeeData: async () => ({ maxFeePerGas: BigInt(MAX_FEE_PER_GAS_WEI), gasPrice: BigInt(MAX_FEE_PER_GAS_WEI) }),
    };
    (adapter as unknown as { provider: unknown }).provider = provider;
    return adapter;
  }

  it('nets the reserve gas cost off the balance in wei', async () => {
    const balanceWei = ethers.parseEther('1');
    const adapter = adapterWithBalance(balanceWei);

    const estimate = await adapter.estimateMaxSend('0x2222222222222222222222222222222222222222', {
      gasLimit: GAS_LIMIT,
      maxFeePerGasWei: MAX_FEE_PER_GAS_WEI,
      maxPriorityFeePerGasWei: '1000000000',
    });

    expect(estimate.amountString).toBe(ethers.formatEther(balanceWei - RESERVE_WEI));
    expect(estimate.fee).toBe(parseFloat(ethers.formatEther(RESERVE_WEI)));
  });

  // The node rejects the transaction unless value + gasLimit * maxFeePerGas fits inside the
  // balance, so the quoted max must never round up past it.
  it('quotes an amount the balance still covers once gas is added, down to the wei', async () => {
    const balanceWei = BigInt('1234567890123456789');
    const adapter = adapterWithBalance(balanceWei);

    const estimate = await adapter.estimateMaxSend('0x2222222222222222222222222222222222222222', {
      gasLimit: GAS_LIMIT,
      maxFeePerGasWei: MAX_FEE_PER_GAS_WEI,
    });

    expect(ethers.parseEther(estimate.amountString) + RESERVE_WEI).toBeLessThanOrEqual(balanceWei);
  });

  it('returns zero rather than a negative amount when gas exceeds the balance', async () => {
    const adapter = adapterWithBalance(BigInt(1));

    const estimate = await adapter.estimateMaxSend('0x2222222222222222222222222222222222222222', {
      gasLimit: GAS_LIMIT,
      maxFeePerGasWei: MAX_FEE_PER_GAS_WEI,
    });

    expect(estimate.amountString).toBe('0.0');
    expect(estimate.amount).toBe(0);
  });

  it('falls back to the network fee data when no fee options are supplied', async () => {
    const balanceWei = ethers.parseEther('2');
    const adapter = adapterWithBalance(balanceWei);

    const estimate = await adapter.estimateMaxSend('0x2222222222222222222222222222222222222222');

    expect(estimate.amountString).toBe(ethers.formatEther(balanceWei - RESERVE_WEI));
  });

  it('offers the whole token balance, since gas is paid in ETH', async () => {
    const tokenBalance = BigInt('12345678'); // 12.345678 USDT
    const adapter = adapterWithBalance(ethers.parseEther('1'), tokenBalance);

    const estimate = await adapter.estimateMaxSend('0x2222222222222222222222222222222222222222', {
      gasLimit: '65000',
      maxFeePerGasWei: MAX_FEE_PER_GAS_WEI,
      tokenSymbol: 'USDT',
    });

    expect(estimate.amountString).toBe('12.345678');
    expect(estimate.fee).toBe(parseFloat(ethers.formatEther(BigInt(65000) * BigInt(MAX_FEE_PER_GAS_WEI))));
  });

  it('rejects a token that has no contract on the active network', async () => {
    const adapter = adapterWithBalance(ethers.parseEther('1'));
    await adapter.init(Network.Mainnet);
    (adapter as unknown as { provider: unknown }).provider = { getBalance: async () => BigInt(0) };

    await expect(
      adapter.estimateMaxSend('0x2222222222222222222222222222222222222222', { tokenSymbol: 'NOPE' }),
    ).rejects.toThrow(/unavailable on this network/);
  });
});
