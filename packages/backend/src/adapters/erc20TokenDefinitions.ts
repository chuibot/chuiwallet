import { Network } from '../types/electrum';

export type Erc20TokenDefinition = Readonly<{
  symbol: string;
  decimals?: number;
  coingeckoId?: string;
  contracts: Partial<Record<Network, string>>;
}>;

/**
 * Supported ERC-20 token contracts on Ethereum networks.
 *
 * This is the single source of truth for ERC-20 contract addresses across the
 * extension — both the EthereumAdapter (balance/history/sending) and the popup
 * UI (display/verification) read from here. Add new tokens in one place.
 */
export const ERC20_TOKEN_DEFINITIONS: Record<string, Erc20TokenDefinition> = {
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
      [Network.Testnet]: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    },
  },
};

/** Look up an ERC-20 contract address by token symbol and network. */
export function getErc20ContractAddress(tokenSymbol: string, network: Network): string | undefined {
  return ERC20_TOKEN_DEFINITIONS[tokenSymbol]?.contracts[network];
}
