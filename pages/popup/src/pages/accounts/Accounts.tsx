import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '@src/components/Header';
import AccountItem from '@src/components/AccountItem';
import { ButtonOutline } from '@src/components/ButtonOutline';
import { useWalletContext } from '@src/context/WalletContext';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '@src/utils';
import Skeleton from 'react-loading-skeleton';

export const Accounts: React.FC = () => {
  const navigate = useNavigate();
  const { accounts, preferences, balance, addAccount, switchAccount } = useWalletContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  const activeNetwork = preferences?.activeNetwork;
  const activeAccountIndex = preferences?.activeAccountIndex ?? -1;

  const accountRows = useMemo(
    () =>
      accounts
        .map((account, index) => ({ account, listIndex: index }))
        .filter(({ account }) => account.network === activeNetwork),
    [accounts, activeNetwork],
  );

  const activeBalanceText = balance
    ? preferences?.fiatCurrency === 'USD'
      ? `${formatNumber(balance.confirmedUsd)} USD`
      : `${formatNumber(balance.confirmed / 1e8, 8)} BTC`
    : preferences?.fiatCurrency === 'USD'
      ? '0 USD'
      : '0 BTC';

  const getAccountAmount = (index: number) => (index === activeAccountIndex ? activeBalanceText : '--');
  const isLoadingAccount = (index: number) => index === activeAccountIndex && balance == null;

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [accountRows.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setIsScrollable(container.scrollHeight > container.clientHeight);
    }
  }, [accountRows.length]);

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Accounts" />
      <div
        ref={containerRef}
        className={`flex flex-col items-center w-full h-[calc(100vh-153px)] mt-2 overflow-y-auto gap-2 [&::-webkit-scrollbar]:w-2
          [&::-webkit-scrollbar-track]:rounded-full
          [&::-webkit-scrollbar-track]:transparent
          [&::-webkit-scrollbar-thumb]:rounded-full
          [&::-webkit-scrollbar-thumb]:bg-neutral-700 ${isScrollable ? 'mr-[-8px] overflow-x-visible' : 'w-full'}`}>
        {accountRows.map(({ account, listIndex }) => (
          <AccountItem
            key={listIndex}
            accountName={account.name}
            address={account.xpub}
            amount={getAccountAmount(listIndex)}
            isLoading={isLoadingAccount(listIndex)}
            selected={listIndex === activeAccountIndex}
            dataTestId={`switch-account-item-${listIndex}`}
            onClick={() => {
              void (async () => {
                await switchAccount(listIndex);
                navigate('/dashboard');
              })();
            }}
          />
        ))}
      </div>
      {accountRows.length === 0 ? (
        <Skeleton className="absolute !w-[343px] !bottom-[-12px] !h-[58px] !rounded-[1rem]" />
      ) : (
        <>
          <ButtonOutline className="absolute w-full bottom-[19px]" onClick={() => void addAccount()}>
            Create account
          </ButtonOutline>
        </>
      )}
    </div>
  );
};

export default Accounts;
