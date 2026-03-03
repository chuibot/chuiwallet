import { ethers } from 'ethers';
import { Network } from '../types/electrum';
import {
  ChainType,
  type IChainAdapter,
  type ChainBalance,
  type ChainTransaction,
  type ChainFeeEstimate,
  type ChainSendOptions,
} from './IChainAdapter';

/**
 * USDT contract addresses on Ethereum networks.
 * @see https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7
 */
const USDT_CONTRACTS: Record<string, string> = {
  mainnet: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  // Sepolia doesn't have an official USDT; we'll use a test ERC-20 later or empty
  testnet: '',
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

  /** Cached ETH price in USD */
  private cachedEthPrice = 0;
  private ethPriceFetchedAt = 0;
  private static readonly PRICE_CACHE_MS = 60_000; // 60s cache

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

  /**
   * Fetch ETH price in USD from CoinGecko (free, no API key).
   * Cached for 60 seconds to avoid hitting rate limits.
   */
  private async getEthPriceUsd(): Promise<number> {
    const now = Date.now();
    if (this.cachedEthPrice > 0 && now - this.ethPriceFetchedAt < EthereumAdapter.PRICE_CACHE_MS) {
      return this.cachedEthPrice;
    }
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = (await res.json()) as { ethereum?: { usd?: number } };
      const price = data?.ethereum?.usd ?? 0;
      if (price > 0) {
        this.cachedEthPrice = price;
        this.ethPriceFetchedAt = now;
      }
      return price;
    } catch (e) {
      console.warn('Failed to fetch ETH price', e);
      return this.cachedEthPrice; // return stale price on failure
    }
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

    // Fetch ETH balance and price in parallel
    const [ethBalanceWei, ethPriceUsd] = await Promise.all([this.provider.getBalance(address), this.getEthPriceUsd()]);

    const ethBalanceFloat = parseFloat(ethers.formatEther(ethBalanceWei));
    const ethBalanceUsd = ethBalanceFloat * ethPriceUsd;

    // USDT Balance (if contract exists for this network)
    const usdtAddr = USDT_CONTRACTS[this.network];
    let usdtBalanceFloat = 0;

    if (usdtAddr) {
      try {
        const contract = new ethers.Contract(usdtAddr, ERC20_ABI, this.provider);
        const usdtBalanceRaw: bigint = await contract.balanceOf(address);
        usdtBalanceFloat = parseFloat(ethers.formatUnits(usdtBalanceRaw, 6));
      } catch (e) {
        console.warn('Failed to fetch USDT balance', e);
      }
    }

    return {
      confirmed: ethBalanceFloat,
      unconfirmed: 0,
      confirmedFiat: ethBalanceUsd,
      unconfirmedFiat: 0,
      tokens: {
        USDT: {
          symbol: 'USDT',
          balance: usdtBalanceFloat,
          decimals: 6,
        },
      },
    };
  }

  /** Blockscout API URLs per network (free, no API key required, Etherscan-compatible format) */
  private static readonly BLOCK_EXPLORER_API: Record<Network, string> = {
    [Network.Mainnet]: 'https://eth.blockscout.com/api',
    [Network.Testnet]: 'https://eth-sepolia.blockscout.com/api',
  };

  async getTransactionHistory(): Promise<ChainTransaction[]> {
    const address = this.getReceivingAddress();
    const baseUrl = EthereumAdapter.BLOCK_EXPLORER_API[this.network];

    try {
      const url = `${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);

      const data = (await res.json()) as {
        status: string;
        result: Array<{
          hash: string;
          from: string;
          to: string;
          value: string;
          gasUsed: string;
          gasPrice: string;
          timeStamp: string;
          confirmations: string;
          isError: string;
        }>;
      };

      if (data.status !== '1' || !Array.isArray(data.result)) {
        return [];
      }

      return data.result.map(tx => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        amount: parseFloat(ethers.formatEther(tx.value)),
        fee: parseFloat(ethers.formatEther((BigInt(tx.gasUsed) * BigInt(tx.gasPrice)).toString())),
        timestamp: parseInt(tx.timeStamp, 10),
        confirmations: parseInt(tx.confirmations, 10),
        status:
          tx.isError === '1'
            ? ('failed' as const)
            : parseInt(tx.confirmations, 10) > 0
              ? ('confirmed' as const)
              : ('pending' as const),
        chain: ChainType.Ethereum,
      }));
    } catch (e) {
      console.warn('Failed to fetch ETH transaction history', e);
      return [];
    }
  }

  async estimateFee(to: string, amount: number, options?: ChainSendOptions): Promise<ChainFeeEstimate[]> {
    if (!this.provider) throw new Error('Provider not initialized');
    const feeData = await this.provider.getFeeData();

    const gasPrice = feeData.gasPrice ?? BigInt(0);
    // ERC-20 transfer() costs ~65k gas; native ETH transfer costs 21k
    const gasLimit = options?.tokenAddress ? BigInt(65000) : BigInt(21000);

    const feeWei = gasPrice * gasLimit;
    // Convert to ETH display units to match balance convention
    const feeEth = parseFloat(ethers.formatEther(feeWei));

    return [
      {
        name: 'Standard',
        fee: feeEth,
        minerTip: 0,
        timeEstimate: 1, // ~15s blocks
      },
    ];
  }

  async sendPayment(
    to: string,
    amount: number, // amount in smallest unit (Wei or Token base unit)
    options?: ChainSendOptions,
  ): Promise<string> {
    if (!this.provider || !this.hdNode) throw new Error('Not initialized');

    const wallet = this.hdNode.deriveChild(this.activeAddressIndex).connect(this.provider);

    // Check if sending ETH or Token
    const tokenAddress = options?.tokenAddress;

    let tx;
    if (tokenAddress) {
      // ERC-20 Transfer
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      tx = await contract.transfer(to, BigInt(amount));
    } else {
      // Native ETH Transfer
      tx = await wallet.sendTransaction({
        to,
        value: BigInt(amount),
      });
    }

    return tx.hash;
  }
}
