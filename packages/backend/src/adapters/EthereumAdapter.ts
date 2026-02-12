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

  /** Infura project ID — will be moved to env/config in future */
  private infuraProjectId = 'ce5ff7944bb343c2a0518772a7196058'; // Public test ID or placeholder using known public nodes

  private readonly RPC_URLS: Record<string, string> = {
    mainnet: 'https://mainnet.infura.io/v3/',
    testnet: 'https://sepolia.infura.io/v3/',
  };

  initWithMnemonic(mnemonic: string, addressIndex: number = 0): void {
    this.activeAddressIndex = addressIndex;
    // m/44'/60'/0'/0 is the standard BIP-44 path for Ethereum
    this.hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic), `m/44'/60'/0'/0`);
  }

  async init(network: Network): Promise<void> {
    this.network = network;
    const baseUrl = this.RPC_URLS[network] || this.RPC_URLS['mainnet'];
    // Fallback to public RPC if no Infura ID, to avoid crash details
    const rpcUrl = this.infuraProjectId
      ? baseUrl + this.infuraProjectId
      : network === Network.Mainnet
        ? 'https://eth.llama.fi'
        : 'https://rpc.sepolia.org';

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async connect(): Promise<void> {
    if (this.provider) {
      await this.provider.getNetwork(); // Verify connection
    }
  }

  async disconnect(): Promise<void> {
    this.provider = null;
  }

  deriveAddress(_accountIndex: number, addressIndex: number): string {
    if (!this.hdNode) {
      throw new Error('EthereumAdapter not initialized with mnemonic');
    }
    return this.hdNode.deriveChild(addressIndex).address;
  }

  getReceivingAddress(): string {
    return this.deriveAddress(0, this.activeAddressIndex);
  }

  async getBalance(): Promise<ChainBalance> {
    if (!this.provider) throw new Error('Provider not initialized');
    const address = this.getReceivingAddress();

    // 1. ETH Balance
    const ethBalance = await this.provider.getBalance(address);

    // 2. USDT Balance (if contract exists for this network)
    const usdtAddr = USDT_CONTRACTS[this.network];
    let usdtBalance = BigInt(0);

    if (usdtAddr) {
      try {
        const contract = new ethers.Contract(usdtAddr, ERC20_ABI, this.provider);
        usdtBalance = await contract.balanceOf(address);
      } catch (e) {
        console.warn('Failed to fetch USDT balance', e);
      }
    }

    // TODO: convert to USD values using external oracle
    return {
      symbol: 'ETH',
      native: {
        confirmed: Number(ethBalance), // Wei
        unconfirmed: 0,
      },
      tokens: {
        USDT: {
          symbol: 'USDT',
          balance: Number(usdtBalance), // 6 decimals usually
          decimals: 6,
        },
      },
      usdValue: 0, // Pending oracle integration
      // Mandatory fields from interface (mapping to Native ETH for now)
      confirmed: Number(ethBalance),
      unconfirmed: 0,
      confirmedFiat: 0,
      unconfirmedFiat: 0,
    };
  }

  async getTransactionHistory(): Promise<ChainTransaction[]> {
    // Standard JSON-RPC cannot fetch history by address.
    // Requires Etherscan or Infura generic indexer.
    // Returning empty array for now as per plan.
    return [];
  }

  async estimateFee(to: string, amount: number): Promise<ChainFeeEstimate[]> {
    if (!this.provider) throw new Error('Provider not initialized');
    const feeData = await this.provider.getFeeData();

    // Simple estimate: Gas price * 21000 (standard transfer)
    // For ERC-20 it would be ~65000
    const gasPrice = feeData.gasPrice ?? BigInt(0);
    const baseGas = BigInt(21000); // Standard ETH transfer

    const fee = Number(gasPrice * baseGas);

    return [
      {
        name: 'Standard',
        fee, // In Wei
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
