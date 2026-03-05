import { ethers } from 'ethers';
import { Network } from '../types/electrum';
import { chainBalanceCache } from '../modules/chainBalanceCache';
import { chainTransactionHistoryCache } from '../modules/chainTransactionHistoryCache';
import { assetPriceService } from '../modules/assetPriceService';
import {
  ChainType,
  type IChainAdapter,
  type ChainBalance,
  type ChainTransaction,
  type ChainTransactionHistoryOptions,
  type ChainFeeEstimate,
  type ChainSendOptions,
} from './IChainAdapter';

type Erc20TokenDefinition = Readonly<{
  symbol: string;
  decimals?: number;
  coingeckoId?: string;
  contracts: Partial<Record<Network, string>>;
}>;

/**
 * Supported ERC-20 token contracts on Ethereum networks.
 * Add new tokens here and the adapter can reuse the same balance/history path.
 */
const ERC20_TOKEN_DEFINITIONS: Record<string, Erc20TokenDefinition> = {
  /**
   * Tether USD (ERC-20)
   * @see https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7
   */
  USDT: {
    symbol: 'USDT',
    decimals: 6,
    coingeckoId: 'tether',
    contracts: {
      [Network.Mainnet]: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      [Network.Testnet]: '',
    },
  },
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export class EthereumAdapter implements IChainAdapter {
  readonly chainType = ChainType.Ethereum;
  readonly symbol = 'ETH';
  readonly decimals = 18;
  readonly displayName = 'Ethereum';

  private provider: ethers.JsonRpcProvider | null = null;
  private hdNode: ethers.HDNodeWallet | null = null;
  private activeAddressIndex = 0;
  private network: Network = Network.Mainnet;

  /** Optional Infura/Alchemy project ID injected via constructor */
  private rpcApiKey: string | undefined;

  /** Public RPC fallbacks — no API key required */
  private static readonly PUBLIC_RPC: Record<Network, string> = {
    [Network.Mainnet]: 'https://cloudflare-eth.com',
    [Network.Testnet]: 'https://ethereum-sepolia-rpc.publicnode.com',
  };

  private static readonly INFURA_RPC: Record<Network, string> = {
    [Network.Mainnet]: 'https://mainnet.infura.io/v3/',
    [Network.Testnet]: 'https://sepolia.infura.io/v3/',
  };

  constructor(config?: { rpcApiKey?: string }) {
    this.rpcApiKey = config?.rpcApiKey;
  }

  initWithMnemonic(mnemonic: string, addressIndex: number = 0): void {
    this.activeAddressIndex = addressIndex;
    // m/44'/60'/0'/0 is the standard BIP-44 path for Ethereum
    this.hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic), `m/44'/60'/0'/0`);
  }

  async init(network: Network): Promise<void> {
    this.network = network;

    const rpcUrl = this.rpcApiKey
      ? EthereumAdapter.INFURA_RPC[network] + this.rpcApiKey
      : EthereumAdapter.PUBLIC_RPC[network];

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async connect(): Promise<void> {
    if (this.provider) {
      await this.provider.getNetwork(); // Verify connection
    }
  }

  async disconnect(): Promise<void> {
    // Idempotent — safe to call multiple times.
    // Does NOT null hdNode here; that's done by clearKeys() on lock/logout.
    this.provider = null;
  }

  /**
   * Clear sensitive key material from memory.
   * Call on wallet.lock / wallet.logout.
   */
  clearKeys(): void {
    this.hdNode = null;
    this.activeAddressIndex = 0;
  }

  deriveAddress(accountIndex: number, addressIndex: number): string {
    if (!this.hdNode) {
      throw new Error('EthereumAdapter not initialized with mnemonic');
    }
    // hdNode is rooted at m/44'/60'/0'/0, so deriveChild gives us m/44'/60'/0'/0/{index}
    // For multi-account: we'd need to derive from the mnemonic directly with accountIndex
    // in the path: m/44'/60'/{accountIndex}'/0/{addressIndex}
    // For now, using single-account derivation (accountIndex 0) with addressIndex
    return this.hdNode.deriveChild(addressIndex).address;
  }

  getReceivingAddress(): string {
    return this.deriveAddress(0, this.activeAddressIndex);
  }

  async getBalance(): Promise<ChainBalance> {
    if (!this.provider) throw new Error('Provider not initialized');
    const address = this.getReceivingAddress();
    const balanceScope = this.getBalanceScope(address);

    const priceIds = this.getTrackedPriceIds();
    const [ethBalanceWei, priceByAssetId] = await Promise.all([
      this.provider.getBalance(address),
      assetPriceService.getUsdPrices(priceIds),
    ]);
    const ethPriceUsd = priceByAssetId.ethereum ?? 0;

    const ethBalanceFloat = parseFloat(ethers.formatEther(ethBalanceWei));
    const ethBalanceUsd = ethBalanceFloat * ethPriceUsd;

    const tokenBalances = await this.getErc20Balances(address, priceByAssetId);

    const nextBalance = {
      confirmed: ethBalanceFloat,
      unconfirmed: 0,
      confirmedFiat: ethBalanceUsd,
      unconfirmedFiat: 0,
      nativeFiatRate: ethPriceUsd > 0 ? ethPriceUsd : undefined,
      tokens: tokenBalances,
    };

    await chainBalanceCache.set(balanceScope, nextBalance);
    return nextBalance;
  }

  async getCachedBalance(): Promise<ChainBalance | null> {
    try {
      const address = this.getReceivingAddress();
      return await chainBalanceCache.get(this.getBalanceScope(address));
    } catch {
      return null;
    }
  }

  /** Blockscout API URLs per network (free, no API key required, Etherscan-compatible format) */
  private static readonly BLOCK_EXPLORER_API: Record<Network, string> = {
    [Network.Mainnet]: 'https://eth.blockscout.com/api',
    [Network.Testnet]: 'https://eth-sepolia.blockscout.com/api',
  };

  async getTransactionHistory(options?: ChainTransactionHistoryOptions): Promise<ChainTransaction[]> {
    const historyScope = this.getHistoryScope(options);
    const cachedTransactions = await chainTransactionHistoryCache.get(historyScope);

    const tokenAddress = this.resolveTokenContractAddress(options?.tokenSymbol);
    if (options?.tokenSymbol && !tokenAddress) {
      return cachedTransactions;
    }

    try {
      const latestTransactions = await this.fetchTransactionHistoryFromIndexer(historyScope.address, tokenAddress);
      const mergedTransactions = await chainTransactionHistoryCache.merge(historyScope, latestTransactions);
      return await this.reconcilePendingTransactions(historyScope, mergedTransactions);
    } catch {
      return await this.reconcilePendingTransactions(historyScope, cachedTransactions);
    }
  }

  async getCachedTransactionHistory(options?: ChainTransactionHistoryOptions): Promise<ChainTransaction[]> {
    return chainTransactionHistoryCache.get(this.getHistoryScope(options));
  }

  private async reconcilePendingTransactions(
    historyScope: {
      chain: ChainType;
      network: Network;
      address: string;
      assetKey?: string;
    },
    transactions: ChainTransaction[],
  ): Promise<ChainTransaction[]> {
    if (!this.provider || transactions.length === 0) {
      return transactions;
    }

    const pendingTransactions = transactions.filter(transaction => transaction.status === 'pending');
    if (pendingTransactions.length === 0) {
      return transactions;
    }

    try {
      const currentBlockNumber = await this.provider.getBlockNumber();
      let hasUpdates = false;

      const nextTransactions = await Promise.all(
        transactions.map(async transaction => {
          if (transaction.status !== 'pending') {
            return transaction;
          }

          try {
            const receipt = await this.provider!.getTransactionReceipt(transaction.hash);
            if (!receipt || receipt.blockNumber == null) {
              return transaction;
            }

            const confirmations =
              currentBlockNumber >= receipt.blockNumber ? currentBlockNumber - receipt.blockNumber + 1 : 0;
            const nextStatus = receipt.status === 0 ? ('failed' as const) : ('confirmed' as const);

            hasUpdates = true;
            return {
              ...transaction,
              status: nextStatus,
              confirmations,
            };
          } catch {
            return transaction;
          }
        }),
      );

      if (hasUpdates) {
        return await chainTransactionHistoryCache.merge(historyScope, nextTransactions);
      }

      return nextTransactions;
    } catch {
      return transactions;
    }
  }

  private async fetchTransactionHistoryFromIndexer(
    address: string,
    tokenAddress?: string,
  ): Promise<ChainTransaction[]> {
    const baseUrl = EthereumAdapter.BLOCK_EXPLORER_API[this.network];
    try {
      const action = tokenAddress ? 'tokentx' : 'txlist';
      const contractQuery = tokenAddress ? `&contractaddress=${tokenAddress}` : '';
      const url = `${baseUrl}?module=account&action=${action}&address=${address}${contractQuery}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);

      const data = (await res.json()) as {
        status: string;
        result: Array<{
          hash: string;
          from: string;
          to: string;
          value: string;
          tokenDecimal?: string;
          gasUsed: string;
          gasPrice: string;
          timeStamp: string;
          confirmations: string;
          isError: string;
          txreceipt_status?: string;
        }>;
      };

      if (data.status !== '1' || !Array.isArray(data.result)) {
        return [];
      }

      return data.result.map(tx => {
        const tokenDecimals = Number.parseInt(tx.tokenDecimal ?? '', 10);
        const resolvedTokenDecimals = Number.isFinite(tokenDecimals) ? tokenDecimals : 18;

        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          amount: tokenAddress
            ? parseFloat(ethers.formatUnits(tx.value, resolvedTokenDecimals))
            : parseFloat(ethers.formatEther(tx.value)),
          fee: parseFloat(ethers.formatEther((BigInt(tx.gasUsed) * BigInt(tx.gasPrice)).toString())),
          timestamp: parseInt(tx.timeStamp, 10),
          confirmations: parseInt(tx.confirmations, 10),
          status:
            tx.isError === '1' || tx.txreceipt_status === '0'
              ? ('failed' as const)
              : parseInt(tx.confirmations, 10) > 0
                ? ('confirmed' as const)
                : ('pending' as const),
          chain: ChainType.Ethereum,
        };
      });
    } catch (e) {
      console.warn('Failed to fetch ETH transaction history from indexer', e);
      throw e;
    }
  }

  async estimateFee(_to: string, _amount?: string, options?: ChainSendOptions): Promise<ChainFeeEstimate[]> {
    if (!this.provider) throw new Error('Provider not initialized');
    const requestedTokenAddress = this.resolveRequestedTokenAddress(options);
    if ((options?.tokenSymbol || options?.tokenAddress) && !requestedTokenAddress) {
      throw new Error(`${options?.tokenSymbol ?? 'Token'} is unavailable on this network`);
    }

    const [feeData, latestBlock, ethPriceUsd, recentFeeMarket, rpcPriorityFee] = await Promise.all([
      this.provider.getFeeData(),
      this.provider.getBlock('latest'),
      assetPriceService.getUsdPrice('ethereum'),
      this.getRecentFeeMarket(),
      this.getRpcPriorityFee(),
    ]);

    const gasLimit = options?.gasLimit
      ? this.parsePositiveBigInt(options.gasLimit, 'gas limit')
      : requestedTokenAddress
        ? BigInt(65000)
        : BigInt(21000);

    const tiers = [
      { name: 'Slow', speed: 'slow', numerator: BigInt(9), denominator: BigInt(10) },
      { name: 'Medium', speed: 'medium', numerator: BigInt(1), denominator: BigInt(1) },
      { name: 'Fast', speed: 'fast', numerator: BigInt(115), denominator: BigInt(100) },
    ] as const;

    const baseFeePerGas = recentFeeMarket?.baseFeePerGas ?? latestBlock?.baseFeePerGas ?? null;
    if (baseFeePerGas && baseFeePerGas > BigInt(0)) {
      const prioritySuggestion = feeData.maxPriorityFeePerGas ?? rpcPriorityFee ?? BigInt(0);
      let priorityTips =
        recentFeeMarket?.priorityTips ??
        ([
          prioritySuggestion / BigInt(2),
          prioritySuggestion,
          prioritySuggestion > BigInt(0)
            ? this.applyMultiplier(prioritySuggestion, BigInt(3), BigInt(2))
            : baseFeePerGas / BigInt(10),
        ] as const);

      if (priorityTips.every(priorityTip => priorityTip === BigInt(0))) {
        priorityTips = [BigInt(0), BigInt(0), baseFeePerGas / BigInt(10)] as const;
      }

      return tiers.map((tier, index) => {
        const priorityTip = priorityTips[index];
        const effectiveGasPrice = baseFeePerGas + priorityTip;
        const fallbackMaxFeePerGas = baseFeePerGas * BigInt(2) + priorityTip;
        const suggestedMaxFeePerGas = feeData.maxFeePerGas
          ? this.applyMultiplier(feeData.maxFeePerGas, tier.numerator, tier.denominator)
          : BigInt(0);
        const maxFeePerGas = this.maxBigInt(fallbackMaxFeePerGas, suggestedMaxFeePerGas, effectiveGasPrice);
        const reserveFeeWei = maxFeePerGas * gasLimit;
        const displayFeeWei = effectiveGasPrice * gasLimit;
        const reserveFeeEth = parseFloat(ethers.formatEther(reserveFeeWei));
        const displayFeeEth = parseFloat(ethers.formatEther(displayFeeWei));

        return {
          name: tier.name,
          speed: tier.speed,
          // Reserve the safer max-fee cap for balance checks / send-max.
          fee: reserveFeeEth,
          // Display the effective fee users are likely to pay, not the cap.
          fiatAmount: ethPriceUsd > 0 ? displayFeeEth * ethPriceUsd : undefined,
          rateValue: parseFloat(ethers.formatUnits(effectiveGasPrice, 'gwei')),
          rateUnit: 'gwei',
          sendOptions: {
            gasLimit: gasLimit.toString(),
            maxFeePerGasWei: maxFeePerGas.toString(),
            maxPriorityFeePerGasWei: priorityTip.toString(),
            ...(options?.tokenSymbol ? { tokenSymbol: options.tokenSymbol } : {}),
            ...(requestedTokenAddress ? { tokenAddress: requestedTokenAddress } : {}),
          },
          minerTip: 0,
          timeEstimate: 1,
        };
      });
    }

    const baseGasPrice = feeData.gasPrice ?? BigInt(0);
    if (baseGasPrice <= BigInt(0)) {
      throw new Error('Unable to estimate Ethereum network fee');
    }

    return tiers.map(tier => {
      const gasPrice = this.applyMultiplier(baseGasPrice, tier.numerator, tier.denominator);
      const feeWei = gasPrice * gasLimit;
      const feeEth = parseFloat(ethers.formatEther(feeWei));

      return {
        name: tier.name,
        speed: tier.speed,
        fee: feeEth,
        fiatAmount: ethPriceUsd > 0 ? feeEth * ethPriceUsd : undefined,
        rateValue: parseFloat(ethers.formatUnits(gasPrice, 'gwei')),
        rateUnit: 'gwei',
        sendOptions: {
          gasLimit: gasLimit.toString(),
          gasPriceWei: gasPrice.toString(),
          ...(options?.tokenSymbol ? { tokenSymbol: options.tokenSymbol } : {}),
          ...(requestedTokenAddress ? { tokenAddress: requestedTokenAddress } : {}),
        },
        minerTip: 0,
        timeEstimate: 1,
      };
    });
  }

  async sendPayment(
    to: string,
    amount: string, // amount in display units (ETH or token display amount)
    options?: ChainSendOptions,
  ): Promise<string> {
    if (!this.provider || !this.hdNode) throw new Error('Not initialized');

    const wallet = this.hdNode.deriveChild(this.activeAddressIndex).connect(this.provider);
    const normalizedAmount = this.normalizeDisplayAmount(amount);
    const overrides = this.buildTransactionOverrides(options);

    // Check if sending ETH or Token
    const tokenAddress = this.resolveRequestedTokenAddress(options);
    if ((options?.tokenSymbol || options?.tokenAddress) && !tokenAddress) {
      throw new Error(`${options?.tokenSymbol ?? 'Token'} is unavailable on this network`);
    }

    let tx;
    if (tokenAddress) {
      // ERC-20 Transfer
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const decimals = Number(await contract.decimals());
      const amountInBaseUnit = ethers.parseUnits(normalizedAmount, decimals);
      tx = await contract.transfer(to, amountInBaseUnit, overrides);
    } else {
      // Native ETH Transfer
      const value = ethers.parseEther(normalizedAmount);
      if (value <= BigInt(0)) {
        throw new Error('Amount must be greater than 0');
      }

      tx = await wallet.sendTransaction({
        to,
        value,
        ...overrides,
      });
    }

    return tx.hash;
  }

  private applyMultiplier(value: bigint, numerator: bigint, denominator: bigint): bigint {
    return (value * numerator + denominator - BigInt(1)) / denominator;
  }

  private parsePositiveBigInt(value: string, fieldName: string): bigint {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Invalid ${fieldName}`);
    }

    const parsedValue = BigInt(value);
    if (parsedValue <= BigInt(0)) {
      throw new Error(`${fieldName[0].toUpperCase() + fieldName.slice(1)} must be greater than 0`);
    }

    return parsedValue;
  }

  private parseNonNegativeBigInt(value: string, fieldName: string): bigint {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Invalid ${fieldName}`);
    }

    return BigInt(value);
  }

  private async getRpcPriorityFee(): Promise<bigint | null> {
    if (!this.provider) {
      return null;
    }

    try {
      const rpcPriorityFee = (await this.provider.send('eth_maxPriorityFeePerGas', [])) as string;
      return this.parseOptionalRpcBigInt(rpcPriorityFee);
    } catch {
      return null;
    }
  }

  private async getRecentFeeMarket(): Promise<{
    baseFeePerGas: bigint;
    priorityTips: readonly [bigint, bigint, bigint];
  } | null> {
    if (!this.provider) {
      return null;
    }

    try {
      const feeHistory = (await this.provider.send('eth_feeHistory', ['0x5', 'latest', [10, 50, 90]])) as {
        baseFeePerGas?: string[];
        reward?: string[][];
      };

      if (!Array.isArray(feeHistory.baseFeePerGas) || feeHistory.baseFeePerGas.length === 0) {
        return null;
      }

      const baseFeePerGas = this.parseOptionalRpcBigInt(feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1]);
      if (baseFeePerGas === null || baseFeePerGas <= BigInt(0)) {
        return null;
      }

      const reward = Array.isArray(feeHistory.reward) ? feeHistory.reward : [];
      const priorityTips = [
        this.averageRpcHexValues(reward.map(values => values?.[0])),
        this.averageRpcHexValues(reward.map(values => values?.[1])),
        this.averageRpcHexValues(reward.map(values => values?.[2])),
      ] as const;

      return { baseFeePerGas, priorityTips };
    } catch {
      return null;
    }
  }

  private averageRpcHexValues(values: Array<string | undefined>): bigint {
    let total = BigInt(0);
    let count = BigInt(0);

    values.forEach(value => {
      const parsedValue = this.parseOptionalRpcBigInt(value);
      if (parsedValue !== null) {
        total += parsedValue;
        count += BigInt(1);
      }
    });

    if (count === BigInt(0)) {
      return BigInt(0);
    }

    return (total + count - BigInt(1)) / count;
  }

  private parseOptionalRpcBigInt(value?: string | null): bigint | null {
    if (!value) {
      return null;
    }

    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  private maxBigInt(...values: bigint[]): bigint {
    return values.reduce((maxValue, value) => (value > maxValue ? value : maxValue), BigInt(0));
  }

  private buildTransactionOverrides(options?: ChainSendOptions): ethers.TransactionRequest {
    const overrides: ethers.TransactionRequest = {};
    if (!options) return overrides;

    if (options.gasLimit) {
      overrides.gasLimit = this.parsePositiveBigInt(options.gasLimit, 'gas limit');
    }

    const hasMaxFee = options.maxFeePerGasWei !== undefined;
    const hasMaxPriorityFee = options.maxPriorityFeePerGasWei !== undefined;

    if (hasMaxFee !== hasMaxPriorityFee) {
      throw new Error('Incomplete Ethereum fee options');
    }

    if (hasMaxFee && hasMaxPriorityFee) {
      const maxFeePerGas = this.parsePositiveBigInt(options.maxFeePerGasWei!, 'max fee per gas');
      const maxPriorityFeePerGas = this.parseNonNegativeBigInt(
        options.maxPriorityFeePerGasWei!,
        'max priority fee per gas',
      );

      if (maxPriorityFeePerGas > maxFeePerGas) {
        throw new Error('Max priority fee per gas cannot exceed max fee per gas');
      }

      overrides.maxFeePerGas = maxFeePerGas;
      overrides.maxPriorityFeePerGas = maxPriorityFeePerGas;
      return overrides;
    }

    if (options.gasPriceWei) {
      overrides.gasPrice = this.parsePositiveBigInt(options.gasPriceWei, 'gas price');
    }

    return overrides;
  }

  private normalizeDisplayAmount(amount: string): string {
    const trimmedAmount = amount.trim();
    if (trimmedAmount.startsWith('.')) {
      return `0${trimmedAmount}`;
    }

    if (trimmedAmount.endsWith('.')) {
      return trimmedAmount.slice(0, -1);
    }

    return trimmedAmount;
  }

  private getHistoryScope(options?: ChainTransactionHistoryOptions): {
    chain: ChainType;
    network: Network;
    address: string;
    assetKey?: string;
  } {
    return {
      chain: this.chainType,
      network: this.network,
      address: this.getReceivingAddress(),
      assetKey: options?.tokenSymbol?.toLowerCase(),
    };
  }

  private getBalanceScope(address: string): {
    chain: ChainType;
    network: Network;
    address: string;
  } {
    return {
      chain: this.chainType,
      network: this.network,
      address,
    };
  }

  private resolveTokenContractAddress(tokenSymbol?: string): string | undefined {
    const tokenDefinition = this.getErc20TokenDefinition(tokenSymbol);
    return tokenDefinition?.contracts[this.network] || undefined;
  }

  private resolveRequestedTokenAddress(options?: ChainSendOptions): string | undefined {
    if (!options) {
      return undefined;
    }

    if (options.tokenAddress) {
      return options.tokenAddress;
    }

    return this.resolveTokenContractAddress(options.tokenSymbol);
  }

  private async getErc20Balances(
    address: string,
    priceByAssetId: Record<string, number>,
  ): Promise<NonNullable<ChainBalance['tokens']>> {
    if (!this.provider) {
      return {};
    }

    const tokenDefinitions = this.getSupportedErc20Tokens();
    const tokenEntries = await Promise.all(
      tokenDefinitions.map(async tokenDefinition => {
        const contractAddress = tokenDefinition.contracts[this.network];
        const fallbackDecimals = tokenDefinition.decimals ?? 18;

        if (!contractAddress) {
          const fiatRate = tokenDefinition.coingeckoId ? priceByAssetId[tokenDefinition.coingeckoId] : undefined;
          return [
            tokenDefinition.symbol,
            {
              symbol: tokenDefinition.symbol,
              balance: 0,
              decimals: fallbackDecimals,
              fiatRate,
              balanceFiat: fiatRate ? 0 : undefined,
            },
          ] as const;
        }

        try {
          const contract = new ethers.Contract(contractAddress, ERC20_ABI, this.provider);
          const [rawBalance, onChainDecimals] = await Promise.all([
            contract.balanceOf(address) as Promise<bigint>,
            tokenDefinition.decimals === undefined
              ? (contract.decimals() as Promise<number>)
              : Promise.resolve(tokenDefinition.decimals),
          ]);

          const resolvedDecimals = Number(onChainDecimals);
          const balance = parseFloat(ethers.formatUnits(rawBalance, resolvedDecimals));
          const fiatRate = tokenDefinition.coingeckoId ? priceByAssetId[tokenDefinition.coingeckoId] : undefined;
          return [
            tokenDefinition.symbol,
            {
              symbol: tokenDefinition.symbol,
              balance,
              decimals: resolvedDecimals,
              fiatRate,
              balanceFiat: fiatRate ? balance * fiatRate : undefined,
            },
          ] as const;
        } catch (e) {
          console.warn(`Failed to fetch ${tokenDefinition.symbol} balance`, e);
          const fiatRate = tokenDefinition.coingeckoId ? priceByAssetId[tokenDefinition.coingeckoId] : undefined;
          return [
            tokenDefinition.symbol,
            {
              symbol: tokenDefinition.symbol,
              balance: 0,
              decimals: fallbackDecimals,
              fiatRate,
              balanceFiat: fiatRate ? 0 : undefined,
            },
          ] as const;
        }
      }),
    );

    return Object.fromEntries(tokenEntries);
  }

  private getSupportedErc20Tokens(): Erc20TokenDefinition[] {
    return Object.values(ERC20_TOKEN_DEFINITIONS);
  }

  private getTrackedPriceIds(): string[] {
    const tokenPriceIds = this.getSupportedErc20Tokens()
      .map(tokenDefinition => tokenDefinition.coingeckoId)
      .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0);

    return ['ethereum', ...tokenPriceIds];
  }

  private getErc20TokenDefinition(tokenSymbol?: string): Erc20TokenDefinition | undefined {
    if (!tokenSymbol) {
      return undefined;
    }

    return ERC20_TOKEN_DEFINITIONS[tokenSymbol.toUpperCase()];
  }
}
