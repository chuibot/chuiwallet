import type * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CryptoButton } from '@src/components/CryptoButton';
import { useWalletContext } from '@src/context/WalletContext';
import { useEffect, useState, useMemo } from 'react';
import { formatNumber } from '@src/utils';
import {
  getCurrencyMeta,
  getTokenContractAddress,
  getTransactionHistoryOptionsForCurrency,
  isSupportedSendCurrency,
} from '@src/utils/currencyMeta';
import { ChainType, type ChainTransaction } from '@extension/backend/src/adapters/IChainAdapter';
import { Network } from '@src/types';
import type { TxEntry } from '@extension/backend/src/types/cache';
import TransactionActivityList from '@src/components/TransactionActivityList';
import Header from '@src/components/Header';
import Skeleton from 'react-loading-skeleton';
import { sendMessage } from '@src/utils/bridge';

interface ActivityStates {
  balance?: number;
  balanceUsd?: number;
}

function mapChainTransactionStatus(status: ChainTransaction['status']): TxEntry['status'] {
  if (status === 'confirmed') {
    return 'CONFIRMED';
  }

  if (status === 'failed') {
    return 'FAILED';
  }

  return 'PENDING';
}

function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 7)}...${address.slice(-5)}`;
}

const CHAIN_NETWORK_ICONS: Partial<Record<ChainType, string>> = {
  [ChainType.Ethereum]: 'popup/eth_coin.svg',
  [ChainType.Bitcoin]: 'popup/btc_coin.svg',
};

/**
 * Convert ChainTransaction (from Blockscout/Etherscan) to TxEntry (used by TransactionActivityList).
 * This lets ETH/USDT activity reuse the exact same UI as BTC.
 */
function chainTxToTxEntry(
  tx: ChainTransaction,
  userAddress: string,
  assetFiatRate: number,
  feeFiatRate: number,
): TxEntry {
  const normalizedUser = userAddress.toLowerCase();
  const fromMine = tx.from.toLowerCase() === normalizedUser;
  const toMine = tx.to.toLowerCase() === normalizedUser;
  const isSelfTransfer = fromMine && toMine;
  const isSend = fromMine;
  const displayAmount = isSelfTransfer ? 0 : tx.amount;
  const hasAssetFiatRate = Number.isFinite(assetFiatRate) && assetFiatRate > 0;
  const hasFeeFiatRate = Number.isFinite(feeFiatRate) && feeFiatRate > 0;

  return {
    type: isSend ? 'SEND' : 'RECEIVE',
    status: mapChainTransactionStatus(tx.status),
    amountBtc: displayAmount,
    amountUsd: hasAssetFiatRate ? displayAmount * assetFiatRate : undefined,
    feeBtc: tx.fee,
    feeUsd: hasFeeFiatRate ? tx.fee * feeFiatRate : undefined,
    timestamp: tx.timestamp * 1000, // TxEntry expects ms, ChainTransaction has seconds
    confirmations: tx.confirmations,
    transactionHash: tx.hash,
    sender: tx.from,
    receiver: tx.to,
  };
}

export const Activity: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currency } = useParams<{ currency: string }>();
  const { transactions, refreshTransactions, preferences, balance, chainBalances } = useWalletContext();

  const meta = getCurrencyMeta(currency);
  const activityStates = (location.state as ActivityStates) ?? {};
  const canSend = isSupportedSendCurrency(currency);

  // Chain transaction state for ETH/USDT
  const [chainTxs, setChainTxs] = useState<ChainTransaction[]>([]);
  const [chainTxsLoading, setChainTxsLoading] = useState(false);
  const [userEthAddress, setUserEthAddress] = useState('');
  const chainHistoryOptions = useMemo(() => getTransactionHistoryOptionsForCurrency(currency), [currency]);
  const tokenFiatRate = meta.tokenSymbol ? (chainBalances[meta.chain]?.tokens?.[meta.tokenSymbol]?.fiatRate ?? 0) : 0;
  // Token contract row shown beneath the balance for ERC-20 assets only.
  // Native EVM coins (e.g. ETH on Ethereum) skip this — the asset name already implies the network.
  const tokenContractAddress = getTokenContractAddress(currency, preferences?.activeEvmNetwork ?? Network.Mainnet);
  const networkIcon = CHAIN_NETWORK_ICONS[meta.chain];
  const activeNetworkForChain =
    meta.chain === ChainType.Bitcoin
      ? (preferences?.activeNetwork ?? Network.Mainnet)
      : (preferences?.activeEvmNetwork ?? Network.Mainnet);
  const networkLabel =
    activeNetworkForChain === Network.Testnet
      ? meta.chain === ChainType.Bitcoin
        ? 'Testnet 4'
        : 'Sepolia'
      : undefined;

  // Derive display balance from state (BTC) or chainBalances (ETH/USDT)
  let displayBalance = 0;
  let displayBalanceUsd = 0;

  if (currency === 'btc') {
    displayBalance = activityStates.balance ?? balance?.confirmed ?? 0;
    displayBalanceUsd = activityStates.balanceUsd ?? balance?.confirmedUsd ?? 0;
  } else if (currency === 'eth') {
    const ethBalance = chainBalances[ChainType.Ethereum];
    displayBalance = ethBalance?.confirmed ?? 0;
    displayBalanceUsd = ethBalance?.confirmedFiat ?? 0;
  } else if (meta.tokenSymbol) {
    const ethBalance = chainBalances[ChainType.Ethereum];
    const tokenBalance = ethBalance?.tokens?.[meta.tokenSymbol];
    displayBalance = tokenBalance?.balance ?? 0;
    displayBalanceUsd = tokenBalance?.balanceFiat ?? 0;
  }

  useEffect(() => {
    refreshTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences?.activeAccountIndex]);

  // Fetch chain transaction history and user address for ETH/USDT
  useEffect(() => {
    if (!currency || currency === 'btc') {
      return;
    }

    let cancelled = false;

    setChainTxs([]);
    setChainTxsLoading(true);

    sendMessage<string>('chain.getReceivingAddress', { chain: ChainType.Ethereum })
      .then(addr => {
        if (!cancelled) {
          setUserEthAddress(addr ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUserEthAddress('');
        }
      });

    (async () => {
      let hasCachedTransactions = false;

      try {
        const cachedTransactions = await sendMessage<ChainTransaction[]>('chain.getCachedTransactionHistory', {
          chain: meta.chain,
          ...(chainHistoryOptions ? { options: chainHistoryOptions } : {}),
        });

        if (cancelled) {
          return;
        }

        const nextCachedTransactions = cachedTransactions ?? [];
        setChainTxs(nextCachedTransactions);
        hasCachedTransactions = nextCachedTransactions.length > 0;

        if (hasCachedTransactions) {
          setChainTxsLoading(false);
        }
      } catch (cachedError) {
        console.error('Failed to load cached chain transactions', cachedError);
      }

      try {
        const latestTransactions = await sendMessage<ChainTransaction[]>('chain.getTransactionHistory', {
          chain: meta.chain,
          ...(chainHistoryOptions ? { options: chainHistoryOptions } : {}),
        });

        if (!cancelled) {
          setChainTxs(latestTransactions ?? []);
        }
      } catch (latestError) {
        console.error('Failed to refresh chain transactions', latestError);
        if (!cancelled && !hasCachedTransactions) {
          setChainTxs([]);
        }
      } finally {
        if (!cancelled) {
          setChainTxsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chainHistoryOptions, currency, meta.chain]);

  // Derive ETH price from chain balances for network-fee conversion in tx history
  const ethPriceUsd = useMemo(() => {
    const ethBal = chainBalances[ChainType.Ethereum];
    if (ethBal?.nativeFiatRate && ethBal.nativeFiatRate > 0) {
      return ethBal.nativeFiatRate;
    }

    if (ethBal && ethBal.confirmed > 0 && ethBal.confirmedFiat > 0) {
      return ethBal.confirmedFiat / ethBal.confirmed;
    }
    return 0;
  }, [chainBalances]);

  const assetFiatRate = useMemo(() => {
    if (meta.tokenSymbol) {
      const tokenBalance = chainBalances[meta.chain]?.tokens?.[meta.tokenSymbol];
      return tokenBalance?.fiatRate ?? 0;
    }

    return ethPriceUsd;
  }, [chainBalances, ethPriceUsd, meta.chain, meta.tokenSymbol]);

  // Convert ChainTransaction[] to TxEntry[] for reuse with TransactionActivityList
  const chainTxEntries: TxEntry[] = useMemo(
    () => chainTxs.map(tx => chainTxToTxEntry(tx, userEthAddress, assetFiatRate, ethPriceUsd)),
    [assetFiatRate, chainTxs, userEthAddress, ethPriceUsd],
  );

  const loading = currency === 'btc' ? transactions == null : chainTxsLoading;

  return (
    <div className="flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header
        title={
          <span className="w-full flex justify-center items-center gap-1">
            <img
              loading="lazy"
              src={chrome.runtime.getURL(meta.icon)}
              alt=""
              className="object-contain shrink-0 self-stretch my-auto w-4 aspect-square"
            />
            {meta.name}
          </span>
        }
      />

      <div className="flex flex-col mt-10 max-w-full leading-none text-center text-white">
        <div className="flex gap-px justify-center items-center w-full text-lg">
          <div className="self-stretch my-auto">Total Balance</div>
        </div>
        <div className="flex justify-center items-end mt-2 text-5xl font-bold uppercase cursor-pointer gap-[8px] flex-wrap max-w-[320px]">
          <span>
            {currency === 'btc'
              ? preferences?.fiatCurrency !== 'BTC'
                ? formatNumber(displayBalanceUsd)
                : formatNumber(displayBalance / 1e8, 8)
              : formatNumber(displayBalance, meta.displayPrecision)}
          </span>
          <span className="text-xl">{currency === 'btc' ? preferences?.fiatCurrency : meta.symbol}</span>
        </div>
      </div>

      <div className="mt-2 text-sm leading-none text-center text-white cursor-pointer">
        {currency === 'btc'
          ? preferences?.fiatCurrency !== 'BTC'
            ? `${formatNumber(displayBalance / 1e8, 8)} BTC`
            : `${formatNumber(displayBalanceUsd)} ${preferences?.fiatCurrency || 'USD'}`
          : meta.tokenSymbol
            ? tokenFiatRate > 0
              ? `≈ ${formatNumber(displayBalanceUsd)} ${preferences?.fiatCurrency || 'USD'}`
              : `${preferences?.fiatCurrency || 'USD'} unavailable`
            : `≈ ${formatNumber(displayBalanceUsd)} ${preferences?.fiatCurrency || 'USD'}`}
      </div>

      {tokenContractAddress && networkIcon && (
        <div className="mt-3 flex items-center gap-1.5 text-xs leading-none text-foreground-79">
          <img loading="lazy" src={chrome.runtime.getURL(networkIcon)} alt="" className="object-contain w-3.5 h-3.5" />
          <span title={tokenContractAddress}>{truncateAddress(tokenContractAddress)}</span>
        </div>
      )}

      {networkLabel && networkIcon && (
        <div
          className={`${tokenContractAddress ? 'mt-1' : 'mt-3'} flex items-center gap-1.5 text-xs leading-none text-foreground-79`}>
          <img loading="lazy" src={chrome.runtime.getURL(networkIcon)} alt="" className="object-contain w-3.5 h-3.5" />
          <span>{networkLabel}</span>
        </div>
      )}

      <div className="flex gap-2.5 justify-between items-center mt-[44px] w-full text-lg font-medium leading-none text-center whitespace-nowrap max-w-[346px] text-foreground">
        <CryptoButton icon="popup/receive_icon.svg" label="Receive" onClick={() => navigate(`/receive/${currency}`)} />
        <CryptoButton
          icon="popup/send_icon.svg"
          label="Send"
          disabled={!canSend}
          onClick={
            canSend
              ? () =>
                  navigate(`/send/${currency}`, {
                    state: {
                      balance: currency === 'btc' ? displayBalance / 1e8 : displayBalance,
                    },
                  })
              : undefined
          }
        />
      </div>

      <div className="w-full max-w-[346px] mt-4">
        <div className="flex flex-col w-full gap-[7px]">
          <div className="flex justify-between items-center">
            <span className="text-white text-sm font-bold">Activity</span>
            {currency === 'btc' && (
              <span className="text-white text-sm">{formatNumber(transactions?.length || 0)} total</span>
            )}
            {currency !== 'btc' && chainTxEntries.length > 0 && (
              <span className="text-white text-sm">{chainTxEntries.length} total</span>
            )}
          </div>
          {loading ? (
            <>
              <Skeleton className="mt-6 !h-[66px]" />
              <Skeleton className="!h-[66px]" />
              <Skeleton className="!h-[66px]" />
            </>
          ) : currency === 'btc' ? (
            <TransactionActivityList transactions={transactions} />
          ) : (
            <TransactionActivityList
              transactions={chainTxEntries}
              unit={meta.symbol}
              amountDecimals={meta.displayPrecision}
              feeUnit={meta.networkFeeSymbol}
              includeFeeInTotals={!meta.networkFeeSymbol}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Activity;
