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

  /** Public RPC fallbacks — no API key required */
  private static readonly PUBLIC_RPC: Record<Network, string> = {
    [Network.Mainnet]: 'https://cloudflare-eth.com',
    [Network.Testnet]: 'https://rpc.sepolia.org',
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

    // 1. ETH Balance — convert from wei (bigint) to ETH (float) to avoid
    //    BigInt→Number overflow (wei can exceed Number.MAX_SAFE_INTEGER at ~0.009 ETH)
    const ethBalanceWei = await this.provider.getBalance(address);
    const ethBalanceFloat = parseFloat(ethers.formatEther(ethBalanceWei));

    // 2. USDT Balance (if contract exists for this network)
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

    // TODO: convert to USD values using external oracle
    return {
      // Values in display units (ETH, not wei) to preserve precision
      confirmed: ethBalanceFloat,
      unconfirmed: 0,
      confirmedFiat: 0, // Pending oracle integration
      unconfirmedFiat: 0,
      tokens: {
        USDT: {
          symbol: 'USDT',
          balance: usdtBalanceFloat, // Display units (e.g. 100.50 USDT)
          decimals: 6,
        },
      },
    };
  }

  async getTransactionHistory(): Promise<ChainTransaction[]> {
    // Standard JSON-RPC cannot fetch history by address.
    // Requires Etherscan or Infura generic indexer.
    // Returning empty array for now as per plan.
    return [];
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
