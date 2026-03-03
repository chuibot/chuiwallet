import type * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AmountInputField } from '@src/components/AmountInputField';
import { FeeOption } from '@src/components/FeeOption';
import { useEffect, useState } from 'react';
import { getBtcToUsdRate } from '@src/utils';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { useWalletContext } from '@src/context/WalletContext';
import { sendMessage } from '@src/utils/bridge';
import {
  getAssetDisplayPrecision,
  getContextBalanceForCurrency,
  getCurrencyMeta,
  isSupportedSendCurrency,
} from '@src/utils/currencyMeta';
import { currencyMapping, type BalanceData, type Currencies } from '@src/types';
import { ChainType, type ChainBalance, type ChainFeeEstimate } from '@extension/backend/src/adapters/IChainAdapter';
import Skeleton from 'react-loading-skeleton';

interface SendOptionsState {
  destinationAddress?: string;
  balance?: number;
}

const DECIMAL_INPUT_REGEX = /^\d*\.?\d*$/;

function formatInputAmount(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '';

  return value.toFixed(digits).replace(/\.?0+$/, '');
}

function normalizeDecimalAmount(value: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.startsWith('.')) {
    return `0${trimmedValue}`;
  }

  if (trimmedValue.endsWith('.')) {
    return trimmedValue.slice(0, -1);
  }

  return trimmedValue;
}

export const SendOptions: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currency } = useParams<{ currency: Currencies }>();
  const { balance, chainBalances } = useWalletContext();
  const states = (location.state as SendOptionsState | null) ?? null;
  const meta = getCurrencyMeta(currency);
  const assetDigits = getAssetDisplayPrecision(currency);

  const [assetAmount, setAssetAmount] = useState('');
  const [usdAmount, setUsdAmount] = useState('');
  const [fiatRate, setFiatRate] = useState<number | null>(null);
  const [selectedFeeIndex, setSelectedFeeIndex] = useState<number>(1);
  const [feeOptions, setFeeOptions] = useState<ChainFeeEstimate[]>([]);
  const [feeEstimatesLoading, setFeeEstimatesLoading] = useState<boolean>(false);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(typeof states?.balance !== 'number');
  const [availableBalance, setAvailableBalance] = useState<number | null>(
    typeof states?.balance === 'number' ? states.balance : null,
  );
  const [lastEditedField, setLastEditedField] = useState<'asset' | 'usd'>('asset');
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

    if (!states?.destinationAddress) {
      navigate(`/send/${currency}`, { replace: true });
    }
  }, [currency, navigate, states?.destinationAddress]);

  useEffect(() => {
    if (!currency || !isSupportedSendCurrency(currency)) return;

    const contextBalance = getContextBalanceForCurrency(currency, balance, chainBalances);
    if (contextBalance !== null) {
      setAvailableBalance(contextBalance);
      setBalanceLoading(false);
      return;
    }

    if (typeof states?.balance === 'number') {
      setAvailableBalance(states.balance);
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
            setAvailableBalance(nextBalance.confirmed / 1e8);
          }
          return;
        }

        const nextBalance = await sendMessage<ChainBalance>('chain.getBalance', { chain: ChainType.Ethereum });
        if (!cancelled) {
          setAvailableBalance(nextBalance.confirmed);
        }
      } catch (fetchError) {
        console.error('Failed to load send balance', fetchError);
        if (!cancelled) {
          setError('Failed to load balance');
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
  }, [balance, chainBalances, currency, states?.balance]);

  useEffect(() => {
    if (!currency || !isSupportedSendCurrency(currency)) return;

    let cancelled = false;

    (async () => {
      try {
        if (currency === 'btc') {
          const rate = await getBtcToUsdRate();
          if (!cancelled) {
            setFiatRate(rate);
          }
          return;
        }

        const existingRate = chainBalances?.[ChainType.Ethereum]?.nativeFiatRate;
        if (existingRate !== undefined && existingRate > 0) {
          if (!cancelled) {
            setFiatRate(existingRate);
          }
          return;
        }

        const ethBalance = await sendMessage<ChainBalance>('chain.getBalance', { chain: ChainType.Ethereum });
        if (!cancelled) {
          setFiatRate(ethBalance.nativeFiatRate ?? null);
        }
      } catch (rateError) {
        console.error('Failed to load fiat rate', rateError);
        if (!cancelled) {
          setFiatRate(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chainBalances, currency]);

  useEffect(() => {
    if (!currency || !isSupportedSendCurrency(currency) || !states?.destinationAddress) return;

    let cancelled = false;
    setFeeEstimatesLoading(true);

    (async () => {
      try {
        const estimates = await sendMessage<ChainFeeEstimate[]>('chain.estimateFee', {
          chain: meta.chain,
          to: states.destinationAddress,
        });

        if (!cancelled) {
          setFeeOptions(estimates);
          setSelectedFeeIndex(estimates.length > 1 ? 1 : 0);
        }
      } catch (feeError) {
        console.error('Failed to load fee estimates', feeError);
        if (!cancelled) {
          setFeeOptions([]);
          setError('Failed to load network fees');
        }
      } finally {
        if (!cancelled) {
          setFeeEstimatesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currency, meta.chain, states?.destinationAddress]);

  useEffect(() => {
    if (fiatRate === null) {
      if (lastEditedField === 'asset' && usdAmount !== '') {
        setUsdAmount('');
      }
      return;
    }

    if (lastEditedField === 'asset') {
      const parsedAssetAmount = Number.parseFloat(assetAmount);
      if (assetAmount === '' || Number.isNaN(parsedAssetAmount)) {
        if (usdAmount !== '') {
          setUsdAmount('');
        }
        return;
      }

      const nextUsdAmount = formatInputAmount(parsedAssetAmount * fiatRate, 2);
      if (nextUsdAmount !== usdAmount) {
        setUsdAmount(nextUsdAmount);
      }
      return;
    }

    const parsedUsdAmount = Number.parseFloat(usdAmount);
    if (usdAmount === '' || Number.isNaN(parsedUsdAmount)) {
      if (assetAmount !== '') {
        setAssetAmount('');
      }
      return;
    }

    const nextAssetAmount = formatInputAmount(parsedUsdAmount / fiatRate, assetDigits);
    if (nextAssetAmount !== assetAmount) {
      setAssetAmount(nextAssetAmount);
    }
  }, [assetAmount, assetDigits, fiatRate, lastEditedField, usdAmount]);

  const selectedFee = feeOptions[selectedFeeIndex];

  const handleNext = () => {
    if (!currency || !states?.destinationAddress || !selectedFee) {
      return;
    }

    const normalizedAssetAmount = normalizeDecimalAmount(assetAmount);
    const parsedAssetAmount = Number.parseFloat(normalizedAssetAmount);
    if (!normalizedAssetAmount || Number.isNaN(parsedAssetAmount) || parsedAssetAmount <= 0) {
      setError('Please input amount');
      return;
    }

    if (availableBalance === null) {
      setError('Balance is still loading');
      return;
    }

    const maxSpendable = availableBalance - selectedFee.fee;
    if (maxSpendable < parsedAssetAmount) {
      setError('Insufficient funds');
      return;
    }

    navigate(`/send/${currency}/preview`, {
      state: {
        destinationAddress: states.destinationAddress,
        amount: normalizedAssetAmount,
        amountUsd: fiatRate !== null && usdAmount !== '' ? Number(usdAmount) : undefined,
        feeAmount: selectedFee.fee,
        feeUsd: selectedFee.fiatAmount,
        feeName: selectedFee.name,
        rateValue: selectedFee.rateValue,
        rateUnit: selectedFee.rateUnit,
        sendOptions: selectedFee.sendOptions,
      },
    });
  };

  const handleAssetAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== '' && !DECIMAL_INPUT_REGEX.test(value)) {
      return;
    }

    setError('');
    setLastEditedField('asset');
    setAssetAmount(value);
  };

  const handleUsdAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== '' && !DECIMAL_INPUT_REGEX.test(value)) {
      return;
    }

    setError('');
    setLastEditedField('usd');
    setUsdAmount(value);
  };

  const handleSetMaxAmount = () => {
    if (availableBalance === null || !selectedFee) {
      return;
    }

    const maxAmount = Math.max(availableBalance - selectedFee.fee, 0);
    setError(maxAmount <= 0 ? 'Insufficient balance' : '');
    setLastEditedField('asset');
    setAssetAmount(formatInputAmount(maxAmount, assetDigits));
  };

  if (!currency || !isSupportedSendCurrency(currency) || !states?.destinationAddress) {
    return null;
  }

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title={`Send ${currencyMapping[currency]}`} />

      <div className="flex flex-col mt-8 w-full text-lg font-bold leading-8 text-white">
        <div className="z-10 self-start">Amount to send</div>
        <div className="flex items-center gap-3 whitespace-nowrap">
          <AmountInputField
            label={meta.symbol}
            placeholder={`0 ${meta.symbol}`}
            id="assetAmount"
            value={assetAmount}
            onChange={handleAssetAmountChange}
            hasIcon={true}
            currency={currency}
            disabled={feeEstimatesLoading || balanceLoading}
          />
          <span className="mt-7 text-[20px]">=</span>
          <AmountInputField
            label="USD"
            placeholder="0 USD"
            id="usdAmount"
            value={usdAmount}
            onChange={handleUsdAmountChange}
            hasIcon={false}
            disabled={feeEstimatesLoading || fiatRate === null}
          />
        </div>
        {fiatRate === null && (
          <div className="mt-2 text-xs font-normal text-foreground-79 self-end">USD unavailable</div>
        )}
        <button
          className="flex gap-1 items-center self-end mt-2 text-sm font-medium text-center text-primary-yellow"
          onClick={handleSetMaxAmount}
          disabled={feeEstimatesLoading || balanceLoading || !selectedFee}>
          <span className="self-stretch my-auto">Send Max</span>
        </button>
      </div>

      <div className="flex flex-col mt-4 w-full items-end">
        <div className="self-start text-lg font-bold leading-8 text-white mb-0.5">Choose fees</div>
        <div className="flex gap-2 items-center text-center">
          <div className="flex gap-2 items-center self-stretch my-auto min-w-[240px] w-[346px]">
            {feeEstimatesLoading ? (
              <>
                <Skeleton className="!w-[110px] !h-[110px] !rounded-2xl" />
                <Skeleton className="!w-[110px] !h-[110px] !rounded-2xl" />
                <Skeleton className="!w-[110px] !h-[110px] !rounded-2xl" />
              </>
            ) : (
              feeOptions.map((option, index) => (
                <FeeOption
                  key={`${option.name ?? option.speed ?? 'fee'}-${index}`}
                  name={option.name}
                  fee={option.fee}
                  fiatAmount={option.fiatAmount}
                  rateValue={option.rateValue}
                  rateUnit={option.rateUnit}
                  symbol={meta.symbol}
                  selected={selectedFeeIndex === index}
                  onSelect={() => setSelectedFeeIndex(index)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="absolute w-full bottom-0 flex flex-col justify-start items-center">
        <Button
          className="mb-2"
          onClick={handleNext}
          disabled={!assetAmount || feeEstimatesLoading || balanceLoading || !selectedFee}>
          Next
        </Button>
        {error && <div className="w-full mt-2 p-2 bg-red-600 text-center">{error}</div>}
      </div>
    </div>
  );
};
