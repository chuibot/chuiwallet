import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { CryptoBalance } from '@src/components/CryptoBalance';
import { useWalletContext } from '@src/context/WalletContext';
import { capitalize, formatNumber } from '@src/utils';
import Skeleton from 'react-loading-skeleton';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { preferences, balance, activeAccount, connected, refreshBalance, isBackedUp } = useWalletContext();

  React.useEffect(() => {
    refreshBalance();
  }, []);

  let balanceLoading = false;
  balanceLoading = balanceLoading == null ? false : balanceLoading;

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pb-[19px]">
      <div className="flex gap-10 justify-between items-center self-stretch py-3 w-full text-xs font-bold leading-6 bg-dark min-h-[48px] text-neutral-200">
        <button
          className="flex gap-2 justify-center items-center self-stretch px-2 my-auto rounded bg-zinc-800 cursor-pointer"
          onClick={() => navigate('/accounts')}>
          <div className="self-stretch my-auto">{activeAccount?.name ?? 'Account'}</div>
          <img
            loading="lazy"
            src={chrome.runtime.getURL('popup/account_down_arrow.svg')}
            alt=""
            className="object-contain shrink-0 self-stretch my-auto w-3 aspect-square"
          />
        </button>

        <button onClick={() => navigate('/settings')}>
          <img
            loading="lazy"
            src={chrome.runtime.getURL('popup/menu_icon.svg')}
            alt=""
            className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
          />
        </button>
      </div>

      {!isBackedUp && (
        <button
          onClick={() => navigate('/settings/advanced/reveal-seed')}
          className="flex items-center justify-center gap-2 mt-4 hover:opacity-80 transition-opacity cursor-pointer mx-auto">
          <div className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
            !
          </div>
          <span className="text-sm font-medium text-red-500">Wallet not backed up</span>
        </button>
      )}

      <div className="flex flex-col mt-10 max-w-full leading-none text-center text-white">
        <div className="flex gap-px justify-center items-center w-full text-lg">
          <div className="self-stretch my-auto">Total Balance</div>
        </div>
        <div className="flex justify-center items-end mt-2 text-5xl font-bold uppercase cursor-pointer gap-[8px] flex-wrap max-w-[320px]">
          {balanceLoading ? (
            <>
              <Skeleton className="!w-[150px] !h-[48px] !rounded-sm" />
            </>
          ) : (
            <>
              <span>
                {balance
                  ? preferences?.fiatCurrency === 'USD'
                    ? formatNumber(balance.confirmedUsd)
                    : formatNumber(balance.confirmed / 1e8, 8)
                  : '0'}
              </span>
              <span className="text-xl">{preferences?.fiatCurrency}</span>
            </>
          )}
        </div>
      </div>

      {balanceLoading ? (
        <Skeleton className="mt-2 !w-[100px] !h-[16px] !rounded-sm" />
      ) : (
        <div className="mt-2 text-sm leading-none text-center text-white cursor-pointer">
          {balance
            ? preferences?.fiatCurrency === 'USD'
              ? formatNumber(balance.confirmed / 1e8, 8)
              : formatNumber(balance.confirmedUsd)
            : '0'}{' '}
          {preferences?.fiatCurrency === 'USD' ? 'BTC' : 'USD'}
        </div>
      )}

      {!balanceLoading && balance && balance.unconfirmed > 0 && (
        <div className="mt-2 text-sm leading-none text-center text-neutral-400">
          <span className="text-green-500 mr-2">Unconfirmed</span>+
          {preferences?.fiatCurrency === 'USD'
            ? formatNumber(balance.unconfirmedUsd)
            : formatNumber(balance.unconfirmed / 1e8, 8)}{' '}
          {preferences?.fiatCurrency === 'USD' ? 'USD' : 'BTC'}
        </div>
      )}

      <div className="flex gap-2.5 justify-between items-center mt-[44px] w-full text-lg font-medium leading-none text-center whitespace-nowrap max-w-[346px] text-foreground">
        {balanceLoading ? (
          <>
            <Skeleton className="min-w-[160px] !w-full !h-[54px] !rounded-[1rem]" />
            <Skeleton className="min-w-[160px] !w-full !h-[54px] !rounded-[1rem]" />
          </>
        ) : null}
      </div>

      <div className="flex flex-col w-full max-w-[346px] gap-[7px] mt-4">
        <CryptoBalance
          cryptoName="Bitcoin"
          cryptoAmount={
            balance
              ? preferences?.fiatCurrency === 'USD'
                ? `${formatNumber(balance.confirmedUsd)} USD`
                : `${formatNumber(balance.confirmed / 1e8, 8)} BTC`
              : preferences?.fiatCurrency === 'USD'
                ? '0 USD'
                : '0 BTC'
          }
          usdAmount={
            balance
              ? preferences?.fiatCurrency === 'USD'
                ? `${formatNumber(balance.confirmed / 1e8, 8)} BTC`
                : `${formatNumber(balance.confirmedUsd)} USD`
              : preferences?.fiatCurrency === 'USD'
                ? '0 BTC'
                : '0 USD'
          }
          icon="popup/btc_coin.svg"
          isLoading={balanceLoading}
          onClick={() =>
            navigate('/dashboard/btc/activity', {
              state: {
                balance: balance?.confirmed,
                balanceUsd: balance?.confirmedUsd,
              },
            })
          }
        />
      </div>

      <div className="fixed bottom-0 w-full px-4 py-2 flex justify-end">
        <div className="flex justify-start items-center">
          {connected === 'connected' ? (
            <div className="bg-green-600 h-2 w-2 rounded-2xl mr-1"></div>
          ) : (
            <div className="bg-red-600 h-2 w-2 rounded-2xl mr-1"></div>
          )}
          {capitalize(connected)}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
