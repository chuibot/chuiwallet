import { AddressInputField } from '@src/components/AddressInputField';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { useWalletContext } from '@src/context/WalletContext';
import { sendMessage } from '@src/utils/bridge';
import { getContextBalanceForCurrency, getCurrencyMeta, isSupportedSendCurrency } from '@src/utils/currencyMeta';
import { currencyMapping, type BalanceData, type Currencies } from '@src/types';
import { isValidAddress } from '@src/utils';
import { ChainType, type ChainBalance } from '@extension/backend/src/adapters/IChainAdapter';
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

interface SendState {
  balance?: number;
}

export const Send: React.FC = () => {
  const navigate = useNavigate();
  const { preferences, balance, chainBalances } = useWalletContext();
  const location = useLocation();
  const { currency } = useParams<{ currency: Currencies }>();
  const states = (location.state as SendState | null) ?? null;
  const meta = getCurrencyMeta(currency);
  const [resolvedBalance, setResolvedBalance] = useState<number | null>(
    typeof states?.balance === 'number' ? states.balance : null,
  );
  const [balanceLoading, setBalanceLoading] = useState<boolean>(typeof states?.balance !== 'number');

  const [destinationAddress, setDestinationAddress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currency) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!isSupportedSendCurrency(currency)) {
      navigate(`/dashboard/${currency}/activity`, { replace: true });
      return;
    }

    const contextBalance = getContextBalanceForCurrency(currency, balance, chainBalances);
    if (contextBalance !== null) {
      setResolvedBalance(contextBalance);
      setBalanceLoading(false);
      return;
    }

    let cancelled = false;
    setBalanceLoading(true);

    (async () => {
      try {
        if (currency === 'btc') {
          const nextBalance = await sendMessage<BalanceData>('wallet.getBalance');
          if (!cancelled) {
            setResolvedBalance(nextBalance.confirmed / 1e8);
          }
          return;
        }

        const nextBalance = await sendMessage<ChainBalance>('chain.getBalance', { chain: ChainType.Ethereum });
        if (!cancelled) {
          if (meta.tokenSymbol) {
            setResolvedBalance(nextBalance.tokens?.[meta.tokenSymbol]?.balance ?? 0);
          } else {
            setResolvedBalance(nextBalance.confirmed);
          }
        }
      } catch (fetchError) {
        console.error('Failed to resolve send balance', fetchError);
        if (!cancelled) {
          navigate(`/dashboard/${currency}/activity`, { replace: true });
        }
      } finally {
        if (!cancelled) {
          setBalanceLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [balance, chainBalances, currency, meta.tokenSymbol, navigate]);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDestinationAddress(value);
    if (isValidAddress(value, currency!, preferences.activeNetwork)) {
      setError('');
    }
  };

  const handleNext = () => {
    if (!currency || !isSupportedSendCurrency(currency)) {
      return;
    }

    if (resolvedBalance === null) {
      setError('Balance is still loading');
      return;
    }

    if (!isValidAddress(destinationAddress, currency!, preferences!.activeNetwork)) {
      setError(`Please enter a valid ${currency!.toUpperCase()} address`);
      return;
    }
    navigate('options', {
      state: {
        destinationAddress,
        balance: resolvedBalance,
      },
    });
  };

  if (!currency || !isSupportedSendCurrency(currency)) {
    return null;
  }

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title={`Send ${currencyMapping[currency!]}`} />

      <img
        loading="lazy"
        src={chrome.runtime.getURL(`popup/${currency ? currency : 'unknown'}_coin.svg`)}
        alt=""
        className="object-contain mt-14 w-12 aspect-square"
      />

      <div className="mt-14 w-full text-lg font-bold relative">
        <AddressInputField
          label="Destination address"
          type="text"
          placeholder=""
          id="destinationAddress"
          value={destinationAddress}
          onChange={handleAddressChange}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleNext();
            }
          }}
        />
        <p className="mt-2 text-xs text-primary-red font-normal h-[20px]">{error}</p>
      </div>

      <Button className="absolute w-full bottom-[19px]" onClick={handleNext} disabled={balanceLoading}>
        Next
      </Button>
    </div>
  );
};
