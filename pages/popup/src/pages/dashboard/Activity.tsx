import type * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CryptoButton } from '@src/components/CryptoButton';
import { useWalletContext } from '@src/context/WalletContext';
import { useEffect, useState, useMemo } from 'react';
import { formatNumber } from '@src/utils';
import { getCurrencyMeta } from '@src/utils/currencyMeta';
import { ChainType, type ChainTransaction } from '@extension/backend/src/adapters/IChainAdapter';
import type { TxEntry } from '@extension/backend/src/types/cache';
import TransactionActivityList from '@src/components/TransactionActivityList';
import Header from '@src/components/Header';
import Skeleton from 'react-loading-skeleton';
import { sendMessage } from '@src/utils/bridge';

interface ActivityStates {
  balance?: number;
  balanceUsd?: number;
}

/**
 * Convert ChainTransaction (from Blockscout/Etherscan) to TxEntry (used by TransactionActivityList).
 * This lets ETH/USDT activity reuse the exact same UI as BTC.
 */
function chainTxToTxEntry(tx: ChainTransaction, userAddress: string, ethPriceUsd: number): TxEntry {
  const isSend = tx.from.toLowerCase() === userAddress.toLowerCase();
  return {
    type: isSend ? 'SEND' : 'RECEIVE',
    status: tx.status === 'confirmed' ? 'CONFIRMED' : 'PENDING',
    amountBtc: tx.amount,
    amountUsd: tx.amount * ethPriceUsd,
    feeBtc: tx.fee,
    feeUsd: tx.fee * ethPriceUsd,
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

  // Chain transaction state for ETH/USDT
  const [chainTxs, setChainTxs] = useState<ChainTransaction[]>([]);
  const [chainTxsLoading, setChainTxsLoading] = useState(false);
  const [userEthAddress, setUserEthAddress] = useState('');

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
  } else if (currency === 'usdt') {
    const ethBalance = chainBalances[ChainType.Ethereum];
    const usdtToken = ethBalance?.tokens?.USDT;
    displayBalance = usdtToken?.balance ?? 0;
    displayBalanceUsd = usdtToken?.balance ?? 0;
  }

  useEffect(() => {
    refreshTransactions();
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
  }, [currency, meta.chain]);

  // Derive ETH price from chain balances for USD conversion in tx history
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

  // Convert ChainTransaction[] to TxEntry[] for reuse with TransactionActivityList
  const chainTxEntries: TxEntry[] = useMemo(
    () => chainTxs.map(tx => chainTxToTxEntry(tx, userEthAddress, ethPriceUsd)),
    [chainTxs, userEthAddress, ethPriceUsd],
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
              ? preferences?.fiatCurrency === 'USD'
                ? formatNumber(displayBalanceUsd)
                : formatNumber(displayBalance / 1e8, 8)
              : formatNumber(displayBalance, currency === 'usdt' ? 2 : 6)}
          </span>
          <span className="text-xl">{currency === 'btc' ? preferences?.fiatCurrency : meta.symbol}</span>
        </div>
      </div>

      <div className="mt-2 text-sm leading-none text-center text-white cursor-pointer">
        {currency === 'btc'
          ? preferences?.fiatCurrency === 'USD'
            ? `${formatNumber(displayBalance / 1e8, 8)} BTC`
            : `${formatNumber(displayBalanceUsd)} USD`
          : `≈ ${formatNumber(displayBalanceUsd)} USD`}
      </div>

      <div className="flex gap-2.5 justify-between items-center mt-[44px] w-full text-lg font-medium leading-none text-center whitespace-nowrap max-w-[346px] text-foreground">
        <CryptoButton icon="popup/receive_icon.svg" label="Receive" onClick={() => navigate(`/receive/${currency}`)} />
        <CryptoButton
          icon="popup/send_icon.svg"
          label="Send"
          onClick={() =>
            navigate(`/send/${currency}`, {
              state: {
                balance: currency === 'btc' ? displayBalance / 1e8 : displayBalance,
              },
            })
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
            <TransactionActivityList transactions={chainTxEntries} unit={meta.symbol} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Activity;
