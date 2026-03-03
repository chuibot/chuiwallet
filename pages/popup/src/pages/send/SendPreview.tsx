import type { ChainSendOptions } from '@extension/backend/src/adapters/IChainAdapter';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';
import type { Currencies } from '@src/types';
import { currencyMapping } from '@src/types';
import Header from '@src/components/Header';
import { Button } from '@src/components/Button';
import { formatNumber } from '@src/utils';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { sendMessage } from '@src/utils/bridge';
import { ERROR_MESSAGES } from '@src/constants';
import { InputField } from '@src/components/InputField';
import { getAssetDisplayPrecision, getCurrencyMeta, isSupportedSendCurrency } from '@src/utils/currencyMeta';
import { formatFeeAmount, formatFeeRate, formatFiatValue } from '@src/utils/sendFormatting';

interface SendPreviewStates {
  destinationAddress?: string;
  amount?: string;
  amountUsd?: number;
  feeAmount?: number;
  feeUsd?: number;
  feeName?: string;
  rateValue?: number;
  rateUnit?: string;
  sendOptions?: ChainSendOptions;
}

export function SendPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currency } = useParams<{ currency: Currencies }>();
  const states = (location.state as SendPreviewStates | null) ?? null;
  const meta = getCurrencyMeta(currency);
  const assetDigits = getAssetDisplayPrecision(currency);
  const formattedFeeRate = formatFeeRate(states?.rateValue, states?.rateUnit);
  const showsRateOnlyFee = states?.rateUnit === 'gwei';

  const [confirmLoading, setConfirmLoading] = useState<boolean>(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);

  useEffect(() => {
    if (!currency) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!isSupportedSendCurrency(currency)) {
      navigate(`/dashboard/${currency}/activity`, { replace: true });
      return;
    }

    if (!states?.destinationAddress || !states.amount || states.feeAmount === undefined) {
      navigate(`/send/${currency}`, { replace: true });
    }
  }, [currency, navigate, states]);

  const handleConfirm = async () => {
    if (!currency || !states?.destinationAddress || !states.amount) {
      return;
    }

    if (!showPasswordInput) {
      setShowPasswordInput(true);
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    setConfirmLoading(true);
    setError('');
    try {
      const isPasswordValid = await sendMessage('wallet.verifyPassword', { password });
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }

      const txid = await sendMessage<string>('chain.sendPayment', {
        chain: meta.chain,
        to: states.destinationAddress,
        amount: states.amount,
        options: states.sendOptions,
      });

      if (txid) {
        navigate(`/send/${currency}/status`, {
          state: {
            status: 'success',
            transactionHash: txid,
          },
        });
      } else {
        setError('Failed to broadcast transaction');
      }
    } catch (e) {
      const errorMessage = String((e as Error)?.message || e || '');
      const normalizedMessage = errorMessage.toLowerCase();

      if (errorMessage.includes('Invalid password')) {
        setError('Invalid password');
      } else if (normalizedMessage.includes('insufficient funds') || normalizedMessage.includes('insufficient')) {
        setError(ERROR_MESSAGES.SEND_TRANSACTION_INSUFFICIENT_FUNDS);
      } else if (meta.chain === ChainType.Bitcoin && normalizedMessage.includes('dust')) {
        setError(ERROR_MESSAGES.SEND_TRANSACTION_TOO_SMALL);
      } else if (meta.chain === ChainType.Bitcoin && normalizedMessage.includes('fee')) {
        setError(ERROR_MESSAGES.SEND_TRANSACTION_FEE_ERROR);
      } else if (meta.chain === ChainType.Ethereum && errorMessage) {
        setError(errorMessage);
      } else {
        setError(ERROR_MESSAGES.SOMETHING_WENT_WRONG_WHILE_SENDING_TRANSACTION);
      }
    } finally {
      setConfirmLoading(false);
    }
  };

  if (!currency || !isSupportedSendCurrency(currency) || !states?.destinationAddress || !states.amount) {
    return null;
  }

  return (
    <div className="flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Confirm Transaction" />

      <div className="flex flex-col mt-14 w-full text-lg flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col w-full leading-none shrink-0">
          <div className="font-medium text-white">Asset Sent</div>
          <div className="flex gap-2 items-center mt-2 w-full text-foreground-79">
            <img
              loading="lazy"
              src={chrome.runtime.getURL(`popup/${currency}_coin.svg`)}
              className="object-contain shrink-0 self-stretch my-auto w-8 aspect-square"
              alt="Asset"
            />
            <div className="self-stretch my-auto">
              {currency ? currencyMapping[currency] : 'Unknown'} ({meta.symbol})
            </div>
          </div>
        </div>
        <div className="flex flex-col mt-6 w-full flex-wrap shrink-0">
          <div className="font-medium leading-none text-white">Destination address</div>
          <div className="mt-2 leading-6 text-foreground-79 text-wrap break-all">{states.destinationAddress}</div>
        </div>
        <div className="flex flex-col mt-6 w-full leading-none text-foreground-79 shrink-0">
          <div className="font-medium text-white">Amount to send</div>
          <div className="mt-2">
            {formatNumber(Number(states.amount), assetDigits)} {meta.symbol}
          </div>
          <div className="mt-2">
            {states.amountUsd !== undefined ? `${formatNumber(states.amountUsd)} USD` : 'USD unavailable'}
          </div>
        </div>
        <div className="flex flex-col mt-6 w-full leading-none text-foreground-79 shrink-0">
          <div className="font-medium text-white">Fee</div>
          <div className="mt-2">
            {showsRateOnlyFee
              ? (formattedFeeRate ?? 'Fee unavailable')
              : states.feeAmount !== undefined
                ? formatFeeAmount(states.feeAmount, meta.symbol)
                : 'Fee unavailable'}
            {!showsRateOnlyFee && formattedFeeRate && <span className="text-sm"> ({formattedFeeRate})</span>}
          </div>
          <div className="mt-2">{formatFiatValue(states.feeUsd)}</div>
        </div>
      </div>

      <div className="w-full shrink-0 flex flex-col border-t border-white/10 pt-4">
        {showPasswordInput && (
          <div className="mb-4">
            <InputField
              label="Password"
              type="password"
              placeholder="Enter your password"
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleConfirm();
                }
              }}
            />
          </div>
        )}

        {error && <span className="mb-4 text-xs text-primary-red font-light">{error}</span>}

        <Button className="flex justify-center gap-2 w-full" onClick={handleConfirm} disabled={confirmLoading}>
          {confirmLoading && (
            <div role="status">
              <svg
                aria-hidden="true"
                className="inline w-5 h-5 text-primary-yellow animate-spin dark:text-gray-600 fill-dark"
                viewBox="0 0 100 101"
                fill="none"
                xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                  fill="currentColor"
                />
                <path
                  d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                  fill="currentFill"
                />
              </svg>
            </div>
          )}
          Confirm & Send
        </Button>
      </div>
    </div>
  );
}
