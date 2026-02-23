import type * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CryptoButton } from '@src/components/CryptoButton';
import { useWalletContext } from '@src/context/WalletContext';
import { useEffect } from 'react';
import { formatNumber } from '@src/utils';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
import { currencyMapping, type Currencies } from '@src/types';
import TransactionActivityList from '@src/components/TransactionActivityList';
import Header from '@src/components/Header';
import Skeleton from 'react-loading-skeleton';

// Maps the :currency URL param to display metadata
const CURRENCY_META: Record<string, { icon: string; name: string; unit: string; chain: ChainType }> = {
  btc: { icon: 'popup/btc_coin.svg', name: 'Bitcoin', unit: 'BTC', chain: ChainType.Bitcoin },
  eth: { icon: 'popup/eth_coin.svg', name: 'Ethereum', unit: 'ETH', chain: ChainType.Ethereum },
  usdt: { icon: 'popup/usdt_coin.svg', name: 'USDT', unit: 'USDT', chain: ChainType.Ethereum },
};

interface ActivityStates {
  balance?: number;
  balanceUsd?: number;
}

export const Activity: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currency } = useParams<{ currency: string }>();
  const { transactions, refreshTransactions, preferences, balance, chainBalances } = useWalletContext();

  const meta = CURRENCY_META[currency ?? 'btc'] ?? CURRENCY_META.btc;
  const activityStates = (location.state as ActivityStates) ?? {};

  // Derive display balance from state (BTC) or chainBalances (ETH/USDT)
  let displayBalance = 0;
  let displayBalanceUsd = 0;

  if (currency === 'btc') {
    // BTC: balance comes from location.state (satoshis) or context
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
    displayBalanceUsd = usdtToken?.balance ?? 0; // USDT ≈ 1:1 USD
  }

  useEffect(() => {
    refreshTransactions();
  }, [preferences?.activeAccountIndex]);

  const loading = currency === 'btc' ? transactions == null : false;

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
          <span className="text-xl">{currency === 'btc' ? preferences?.fiatCurrency : meta.unit}</span>
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
          </div>
          {currency === 'btc' ? (
            loading ? (
              <>
                <Skeleton className="mt-6 !h-[66px]" />
                <Skeleton className="!h-[66px]" />
                <Skeleton className="!h-[66px]" />
              </>
            ) : (
              <TransactionActivityList transactions={transactions} />
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-neutral-400 text-sm">
              <span>No activity yet</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Activity;
