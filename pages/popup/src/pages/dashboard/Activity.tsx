import type * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CryptoButton } from '@src/components/CryptoButton';
import { useWalletContext } from '@src/context/WalletContext';
import { useEffect } from 'react';
import { formatNumber } from '@src/utils';
import TransactionActivityList from '@src/components/TransactionActivityList';
import Header from '@src/components/Header';
import Skeleton from 'react-loading-skeleton';

interface ActivityStates {
  balance: number;
  balanceUsd: number;
}

export const Activity: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { transactions, refreshTransactions, preferences } = useWalletContext();

  const activityStates = location.state as ActivityStates;
  const { balance, balanceUsd } = activityStates;

  useEffect(() => {
    refreshTransactions();
  }, [preferences?.activeAccountIndex]);

  const loading = transactions == null;

  return (
    <div className="flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header
        title={
          <span className="w-full flex justify-center items-center gap-1">
            <img
              loading="lazy"
              src={chrome.runtime.getURL(`popup/btc_coin.svg`)}
              alt=""
              className="object-contain shrink-0 self-stretch my-auto w-4 aspect-square"
            />
            Bitcoin
          </span>
        }
      />

      <div className="flex flex-col mt-10 max-w-full leading-none text-center text-white">
        <div className="flex gap-px justify-center items-center w-full text-lg">
          <div className="self-stretch my-auto">Total Balance</div>
        </div>
        <div className="flex justify-center items-end mt-2 text-5xl font-bold uppercase cursor-pointer gap-[8px] flex-wrap max-w-[320px]">
          <span>
            {preferences?.fiatCurrency === 'USD'
              ? balanceUsd != null
                ? formatNumber(balanceUsd)
                : '0'
              : balance != null
                ? formatNumber(balance / 1e8, 8)
                : '0'}
          </span>
          <span className="text-xl">{preferences?.fiatCurrency}</span>
        </div>
      </div>

      <div className="mt-2 text-sm leading-none text-center text-white cursor-pointer">
        {preferences?.fiatCurrency === 'USD'
          ? balanceUsd != null
            ? formatNumber(balance / 1e8, 8)
            : '0'
          : balance != null
            ? formatNumber(balanceUsd)
            : '0'}{' '}
        {preferences?.fiatCurrency === 'USD' ? 'BTC' : 'USD'}
      </div>

      <div className="flex gap-2.5 justify-between items-center mt-[44px] w-full text-lg font-medium leading-none text-center whitespace-nowrap max-w-[346px] text-foreground">
        <CryptoButton icon="popup/receive_icon.svg" label="Receive" onClick={() => navigate('/receive/btc')} />
        <CryptoButton
          icon="popup/send_icon.svg"
          label="Send"
          onClick={() =>
            navigate('/send/btc', {
              state: {
                balance: balance / 1e8,
              },
            })
          }
        />
      </div>

      <div className="w-full max-w-[346px] mt-4">
        <div className="flex flex-col w-full gap-[7px]">
          <div className="flex justify-between items-center">
            <span className="text-white text-sm font-bold">Activity</span>
            <span className="text-white text-sm">{formatNumber(transactions?.length || 0)} total</span>
          </div>
          {loading ? (
            <>
              <Skeleton className="mt-6 !h-[66px]" />
              <Skeleton className="!h-[66px]" />
              <Skeleton className="!h-[66px]" />
            </>
          ) : (
            <TransactionActivityList transactions={transactions} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Activity;
