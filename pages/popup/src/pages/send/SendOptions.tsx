import type * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AmountInputField } from '@src/components/AmountInputField';
import { FeeOption } from '@src/components/FeeOption';
import { useEffect, useRef, useState } from 'react';
import { getBtcFiatRate } from '@src/utils';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { useWalletContext } from '@src/context/WalletContext';
import { sendMessage } from '@src/utils/bridge';
import {
  getContextBalanceForCurrency,
  getCurrencyMeta,
  getSendAmountPrecision,
  isSupportedSendCurrency,
} from '@src/utils/currencyMeta';
import { currencyMapping, type BalanceData, type Currencies } from '@src/types';
import {
  ChainType,
  type ChainBalance,
  type ChainFeeEstimate,
  type ChainMaxSendEstimate,
} from '@extension/backend/src/adapters/IChainAdapter';
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
  const { balance, chainBalances, preferences } = useWalletContext();
  const states = (location.state as SendOptionsState | null) ?? null;
  const meta = getCurrencyMeta(currency);
  const assetDigits = getSendAmountPrecision(currency);
  const usesSeparateFeeAsset = Boolean(meta.networkFeeSymbol);

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
  const [availableGasBalance, setAvailableGasBalance] = useState<number | null>(
    meta.chain === ChainType.Ethereum ? (chainBalances?.[ChainType.Ethereum]?.confirmed ?? null) : null,
  );
  const [lastEditedField, setLastEditedField] = useState<'asset' | 'usd'>('asset');
  const [error, setError] = useState('');
  const [isMaxSend, setIsMaxSend] = useState(false);
  const [maxSendLoading, setMaxSendLoading] = useState(false);
  // Fee to display for the current max selection, when it differs from the plain estimate
  // (BTC sweep fee scales with the real input count). Null when not a max send.
  const [maxSendFee, setMaxSendFee] = useState<number | null>(null);
  // Guards against a stale estimateMaxSend response overwriting a newer one.
  const maxSendRequestRef = useRef(0);

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
      if (meta.chain === ChainType.Ethereum) {
        setAvailableGasBalance(chainBalances?.[ChainType.Ethereum]?.confirmed ?? null);
      }
      setBalanceLoading(false);
      return;
    }

    if (
      typeof states?.balance === 'number' &&
      (meta.chain !== ChainType.Ethereum || chainBalances?.[ChainType.Ethereum] !== undefined)
    ) {
      setAvailableBalance(states.balance);
      if (meta.chain === ChainType.Ethereum) {
        setAvailableGasBalance(chainBalances?.[ChainType.Ethereum]?.confirmed ?? null);
      }
      setBalanceLoading(false);
      return;
    }

    if (typeof states?.balance === 'number') {
      setAvailableBalance(states.balance);
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
          if (meta.tokenSymbol) {
            setAvailableBalance(nextBalance.tokens?.[meta.tokenSymbol]?.balance ?? 0);
          } else {
            setAvailableBalance(nextBalance.confirmed);
          }
          setAvailableGasBalance(nextBalance.confirmed);
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
  }, [balance, chainBalances, currency, meta.chain, meta.tokenSymbol, states?.balance]);

  useEffect(() => {
    if (!currency || !isSupportedSendCurrency(currency)) return;

    let cancelled = false;

    (async () => {
      try {
        if (currency === 'btc') {
          const fiatCurrency = preferences?.fiatCurrency || 'USD';
          const rate = await getBtcFiatRate(fiatCurrency === 'BTC' ? 'USD' : fiatCurrency);
          if (!cancelled) {
            setFiatRate(rate);
          }
          return;
        }

        if (meta.tokenSymbol) {
          const existingTokenRate = chainBalances?.[ChainType.Ethereum]?.tokens?.[meta.tokenSymbol]?.fiatRate;
          if (existingTokenRate !== undefined && existingTokenRate > 0) {
            if (!cancelled) {
              setFiatRate(existingTokenRate);
            }
            return;
          }

          const ethBalance = await sendMessage<ChainBalance>('chain.getBalance', { chain: ChainType.Ethereum });
          if (!cancelled) {
            setFiatRate(ethBalance.tokens?.[meta.tokenSymbol]?.fiatRate ?? null);
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
  }, [chainBalances, currency, meta.tokenSymbol, preferences?.fiatCurrency]);

  useEffect(() => {
    if (!currency || !isSupportedSendCurrency(currency) || !states?.destinationAddress) return;

    let cancelled = false;
    setFeeEstimatesLoading(true);

    (async () => {
      try {
        const estimates = await sendMessage<ChainFeeEstimate[]>('chain.estimateFee', {
          chain: meta.chain,
          to: states.destinationAddress,
          ...(meta.tokenSymbol ? { options: { tokenSymbol: meta.tokenSymbol } } : {}),
        });

        if (!cancelled) {
          setFeeOptions(estimates);
          setSelectedFeeIndex(estimates.length > 1 ? 1 : 0);
        }
      } catch (feeError) {
        console.error('Failed to load fee estimates', feeError);
        if (!cancelled) {
          setFeeOptions([]);
          const feeErrorMessage = String((feeError as Error)?.message || '');
          setError(
            feeErrorMessage.toLowerCase().includes('unavailable on this network')
              ? feeErrorMessage
              : 'Failed to load network fees',
          );
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
  }, [currency, meta.chain, meta.tokenSymbol, states?.destinationAddress]);

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

  // Drop max-send state and invalidate any in-flight estimate so a late response can't
  // overwrite a manually edited amount.
  const clearMaxSend = () => {
    maxSendRequestRef.current++;
    setIsMaxSend(false);
    setMaxSendFee(null);
    setMaxSendLoading(false);
  };

  // BTC's true max needs real UTXO selection on the backend, since the fee scales with the
  // input count. Netting a flat fee estimate off the balance under- or over-shoots.
  const runBtcMaxSend = async () => {
    if (!selectedFee || !states?.destinationAddress) return;
    const requestId = ++maxSendRequestRef.current;
    setMaxSendLoading(true);
    try {
      const estimate = await sendMessage<ChainMaxSendEstimate>('chain.estimateMaxSend', {
        chain: meta.chain,
        to: states.destinationAddress,
        options: selectedFee.sendOptions,
      });
      if (requestId !== maxSendRequestRef.current) return;
      const maxAmount = Math.max(estimate.amount, 0);
      setError(maxAmount <= 0 ? 'Insufficient balance' : '');
      setIsMaxSend(true);
      setMaxSendFee(estimate.fee);
      setLastEditedField('asset');
      setAssetAmount(formatInputAmount(maxAmount, assetDigits));
    } catch (maxSendError) {
      if (requestId !== maxSendRequestRef.current) return;
      console.error('Failed to compute max send amount', maxSendError);
      setError('Insufficient funds');
    } finally {
      if (requestId === maxSendRequestRef.current) setMaxSendLoading(false);
    }
  };

  // Native account-based chains (ETH): the fee is paid from the same balance, so the max is
  // simply balance minus the flat gas estimate.
  const applyNativeMaxSend = () => {
    if (availableBalance === null || !selectedFee) return;
    const maxAmount = Math.max(availableBalance - selectedFee.fee, 0);
    setError(maxAmount <= 0 ? 'Insufficient balance' : '');
    setIsMaxSend(true);
    setMaxSendFee(selectedFee.fee);
    setLastEditedField('asset');
    setAssetAmount(formatInputAmount(maxAmount, assetDigits));
  };

  // Re-derive the max amount if the user switches fee speed after hitting "Send Max" —
  // a higher rate can eat into the amount a lower rate had left affordable.
  useEffect(() => {
    if (!isMaxSend || usesSeparateFeeAsset || !selectedFee || !states?.destinationAddress) return;
    if (meta.chain === ChainType.Bitcoin) {
      void runBtcMaxSend();
    } else {
      applyNativeMaxSend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFeeIndex]);

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

    if (usesSeparateFeeAsset) {
      if (availableBalance < parsedAssetAmount) {
        setError(`Insufficient ${meta.symbol} balance`);
        return;
      }

      if (availableGasBalance === null) {
        setError(`${meta.networkFeeSymbol} balance is still loading`);
        return;
      }

      if (availableGasBalance < selectedFee.fee) {
        setError(`Insufficient ${meta.networkFeeSymbol} for network fee`);
        return;
      }
    } else if (!isMaxSend) {
      // Skip this check for a max send: the amount was already derived from the fee it's
      // netted against, so re-checking against a re-subtracted fee only risks rounding drift.
      const maxSpendable = availableBalance - selectedFee.fee;
      if (maxSpendable < parsedAssetAmount) {
        setError('Insufficient funds');
        return;
      }
    }

    // For a max send, show the fee the amount was actually netted against, not the flat estimate.
    const feeAmount = isMaxSend && maxSendFee !== null ? maxSendFee : selectedFee.fee;
    const feeUsd =
      isMaxSend && maxSendFee !== null
        ? fiatRate !== null
          ? maxSendFee * fiatRate
          : undefined
        : selectedFee.fiatAmount;

    navigate(`/send/${currency}/preview`, {
      state: {
        destinationAddress: states.destinationAddress,
        amount: normalizedAssetAmount,
        amountUsd: fiatRate !== null && usdAmount !== '' ? Number(usdAmount) : undefined,
        feeAmount,
        feeUsd,
        feeName: selectedFee.name,
        rateValue: selectedFee.rateValue,
        rateUnit: selectedFee.rateUnit,
        sendOptions: {
          ...selectedFee.sendOptions,
          ...(meta.tokenSymbol ? { tokenSymbol: meta.tokenSymbol } : {}),
          // Only BTC sweeps on the backend; ETH's max is the exact amount computed here.
          ...(isMaxSend && meta.chain === ChainType.Bitcoin ? { isMax: true } : {}),
        },
      },
    });
  };

  const handleAssetAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== '' && !DECIMAL_INPUT_REGEX.test(value)) {
      return;
    }

    const valueParts = value.split('.');
    if (valueParts[1] && valueParts[1].length > assetDigits) {
      return;
    }

    setError('');
    clearMaxSend();
    setLastEditedField('asset');
    setAssetAmount(value);
  };

  const handleUsdAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value !== '' && !DECIMAL_INPUT_REGEX.test(value)) {
      return;
    }

    const valueParts = value.split('.');
    if (valueParts[1] && valueParts[1].length > 2) {
      return;
    }

    setError('');
    clearMaxSend();
    setLastEditedField('usd');
    setUsdAmount(value);
  };

  const handleSetMaxAmount = () => {
    if (availableBalance === null || !selectedFee) {
      return;
    }

    // Separate-fee assets (e.g. USDT paying gas in ETH): the whole balance is sendable, the
    // fee is covered by a different asset, so there's nothing to net off.
    if (usesSeparateFeeAsset) {
      const maxAmount = Math.max(availableBalance, 0);
      if (availableGasBalance !== null && availableGasBalance < selectedFee.fee) {
        setError(`Insufficient ${meta.networkFeeSymbol} for network fee`);
      } else {
        setError(maxAmount <= 0 ? 'Insufficient balance' : '');
      }
      clearMaxSend();
      setLastEditedField('asset');
      setAssetAmount(formatInputAmount(maxAmount, assetDigits));
      return;
    }

    if (meta.chain === ChainType.Bitcoin) {
      void runBtcMaxSend();
    } else {
      applyNativeMaxSend();
    }
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
            disabled={feeEstimatesLoading || balanceLoading || maxSendLoading}
          />
          <span className="mt-7 text-[20px]">=</span>
          <AmountInputField
            label={preferences?.fiatCurrency || 'USD'}
            placeholder={`0 ${preferences?.fiatCurrency || 'USD'}`}
            id="usdAmount"
            value={usdAmount}
            onChange={handleUsdAmountChange}
            hasIcon={false}
            disabled={feeEstimatesLoading || fiatRate === null || maxSendLoading}
          />
        </div>
        {fiatRate === null && (
          <div className="mt-2 text-xs font-normal text-foreground-79 self-end">
            {preferences?.fiatCurrency || 'USD'} unavailable
          </div>
        )}
        <button
          className="flex gap-1 items-center self-end mt-2 text-sm font-medium text-center text-primary-yellow"
          onClick={handleSetMaxAmount}
          disabled={feeEstimatesLoading || balanceLoading || maxSendLoading || !selectedFee}>
          <span className="self-stretch my-auto">Send Max</span>
        </button>
        {usesSeparateFeeAsset && (
          <div className="mt-2 text-xs font-normal text-foreground-79 self-start">
            Network fee will be paid in {meta.networkFeeSymbol}
          </div>
        )}
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
                  fiatCurrency={preferences?.fiatCurrency || 'USD'}
                  selected={selectedFeeIndex === index}
                  disabled={maxSendLoading}
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
          disabled={!assetAmount || feeEstimatesLoading || balanceLoading || maxSendLoading || !selectedFee}>
          Next
        </Button>
        {error && <div className="w-full mt-2 p-2 bg-red-600 text-center">{error}</div>}
      </div>
    </div>
  );
};
