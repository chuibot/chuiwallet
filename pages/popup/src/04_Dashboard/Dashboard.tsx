import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { CryptoBalance } from '../components/CryptoBalance';
import { CryptoButton } from '../components/CryptoButton';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletContext } from '@src/context/WalletContext';
import { formatNumber } from '@src/utils';
import Skeleton from 'react-loading-skeleton';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { preferences, balance, activeAccount, refreshBalance } = useWalletContext();

  const [showChooseReceiveCurrencySlide, setShowChooseReceiveCurrencySlide] = React.useState(false);
  const [showChooseSendCurrencySlide, setShowChooseSendCurrencySlide] = React.useState(false);

  const handleToggleChooseReceiveCurrencySlide = () => {
    setShowChooseReceiveCurrencySlide(!showChooseReceiveCurrencySlide);
  };

  const handleToggleChooseSendCurrencySlide = () => {
    setShowChooseSendCurrencySlide(!showChooseSendCurrencySlide);
  };

  React.useEffect(() => {
    console.log('getting new balances..');
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
          <div className="self-stretch my-auto">{activeAccount?.name}</div>
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

      <div className="flex gap-2.5 justify-between items-center mt-[44px] w-full text-lg font-medium leading-none text-center whitespace-nowrap max-w-[346px] text-foreground">
        {balanceLoading ? (
          <>
            <Skeleton className="min-w-[160px] !w-full !h-[54px] !rounded-[1rem]" />
            <Skeleton className="min-w-[160px] !w-full !h-[54px] !rounded-[1rem]" />
          </>
        ) : (
          <>
            {/*<CryptoButton*/}
            {/*  icon="popup/receive_icon.svg"*/}
            {/*  label="Receive"*/}
            {/*  onClick={handleToggleChooseReceiveCurrencySlide}*/}
            {/*/>*/}
            {/*<CryptoButton icon="popup/send_icon.svg" label="Send" onClick={handleToggleChooseSendCurrencySlide} />*/}
          </>
        )}
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
        {/*<CryptoBalance*/}
        {/*  cryptoName="Bitcoin Cash"*/}
        {/*  cryptoAmount={preferences?.fiatCurrency === 'USD' ? `0 USD` : `0 BCH`}*/}
        {/*  usdAmount={preferences?.fiatCurrency === 'USD' ? `0 BCH` : `0 USD`}*/}
        {/*  icon="popup/bch_coin.svg"*/}
        {/*  isLoading={balanceLoading}*/}
        {/*  disabled={true}*/}
        {/*  onClick={() => navigate('/dashboard/bch/activity')}*/}
        {/*/>*/}
        {/*<CryptoBalance*/}
        {/*  cryptoName="USDT"*/}
        {/*  cryptoAmount={preferences?.fiatCurrency === 'USD' ? `0 USD` : `0 USDT`}*/}
        {/*  usdAmount={preferences?.fiatCurrency === 'USD' ? `0 USDT` : `0 USD`}*/}
        {/*  icon="popup/usdt_coin.svg"*/}
        {/*  isLoading={balanceLoading}*/}
        {/*  disabled={true}*/}
        {/*  onClick={() => navigate('/dashboard/usdt/activity')}*/}
        {/*/>*/}
      </div>

      <AnimatePresence>
        {showChooseReceiveCurrencySlide && (
          <motion.div
            className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 z-50 flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleToggleChooseReceiveCurrencySlide}>
            <motion.div
              className="w-full max-w-sm bg-neutral-900 p-4 rounded-t-lg"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.3 }}
              onClick={e => e.stopPropagation()}>
              <div className="text-white text-xl font-bold mb-4">Choose a currency</div>
              <div className="flex flex-col w-full max-w-[346px] gap-[7px]">
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
                  onClick={() => navigate('/receive/btc')}
                />
                <CryptoBalance
                  cryptoName="Bitcoin Cash"
                  cryptoAmount={preferences?.fiatCurrency === 'USD' ? `0 USD` : `0 BCH`}
                  usdAmount={preferences?.fiatCurrency === 'USD' ? `0 BCH` : `0 USD`}
                  icon="popup/bch_coin.svg"
                  isLoading={balanceLoading}
                  disabled={true}
                  onClick={() => navigate('/receive/bch')}
                />
                <CryptoBalance
                  cryptoName="USDT"
                  cryptoAmount={preferences?.fiatCurrency === 'USD' ? `0 USD` : `0 USDT`}
                  usdAmount={preferences?.fiatCurrency === 'USD' ? `0 USDT` : `0 USD`}
                  icon="popup/usdt_coin.svg"
                  isLoading={balanceLoading}
                  disabled={true}
                  onClick={() => navigate('/receive/usdt')}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showChooseSendCurrencySlide && (
          <motion.div
            className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 z-50 flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleToggleChooseSendCurrencySlide}>
            <motion.div
              className="w-full max-w-sm bg-neutral-900 p-4 rounded-t-lg"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.3 }}
              onClick={e => e.stopPropagation()}>
              <div className="text-white text-xl font-bold mb-4">Choose a currency</div>
              <div className="flex flex-col w-full max-w-[346px] gap-[7px]">
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
                    navigate('/send/btc', {
                      state: {
                        balance: balance ? balance.confirmed / 1e8 : 0,
                      },
                    })
                  }
                />
                <CryptoBalance
                  cryptoName="Bitcoin Cash"
                  cryptoAmount={preferences?.fiatCurrency === 'USD' ? `0 USD` : `0 BCH`}
                  usdAmount={preferences?.fiatCurrency === 'USD' ? `0 BCH` : `0 USD`}
                  icon="popup/bch_coin.svg"
                  isLoading={balanceLoading}
                  disabled={true}
                  onClick={() => navigate('/send/bch')}
                />
                <CryptoBalance
                  cryptoName="USDT"
                  cryptoAmount={preferences?.fiatCurrency === 'USD' ? `0 USD` : `0 USDT`}
                  usdAmount={preferences?.fiatCurrency === 'USD' ? `0 USDT` : `0 USD`}
                  icon="popup/usdt_coin.svg"
                  isLoading={balanceLoading}
                  disabled={true}
                  onClick={() => navigate('/send/usdt')}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
