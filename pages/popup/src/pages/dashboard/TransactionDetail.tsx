import type * as React from 'react';
import type { Currencies, TransactionActivityStatus, TransactionType } from '@src/types';
import Header from '@src/components/Header';
import LabelValue from '@src/components/LabelValue';
import { useWalletContext } from '@src/context/WalletContext';
import { formatNumber, formatTimestamp } from '@src/utils';
import { buildTransactionExplorerUrl, getAssetDisplayPrecision, getCurrencyMeta } from '@src/utils/currencyMeta';
import { useLocation, useParams } from 'react-router-dom';

export interface TransactionDetailStates {
  type: TransactionType;
  status: TransactionActivityStatus;
  amountBtc: number;
  amountUsd?: number;
  feeBtc: number;
  feeUsd?: number;
  timestamp: number;
  confirmations: number;
  transactionHash: string;
  sender: string;
  receiver: string;
  feeUnit?: string;
}

export const TransactionDetail: React.FC = () => {
  const { preferences } = useWalletContext();
  const location = useLocation();
  const { currency } = useParams<{ currency: Currencies }>();
  const meta = getCurrencyMeta(currency);
  const assetDigits = getAssetDisplayPrecision(currency);

  const transactionDetailStates = location.state as TransactionDetailStates;
  const { type, status, amountBtc, amountUsd, feeBtc, feeUsd, timestamp, confirmations, transactionHash, feeUnit } =
    transactionDetailStates;
  const explorerUrl = buildTransactionExplorerUrl(currency, preferences.activeNetwork, transactionHash);
  const feeSymbol = feeUnit ?? meta.networkFeeSymbol ?? meta.symbol;
  const feeDigits = feeSymbol === 'BTC' ? 8 : 6;
  const hasAmountUsd = Number.isFinite(amountUsd);
  const hasFeeUsd = Number.isFinite(feeUsd);
  const statusLabel =
    status === 'FAILED' ? 'Failed' : status == 'CONFIRMED' ? (type == 'SEND' ? 'Sent' : 'Received') : 'Pending';
  const statusAlt =
    status === 'FAILED' ? 'Failed' : status == 'CONFIRMED' ? (type == 'SEND' ? 'Sent' : 'Received') : 'Pending';

  return (
    <div className="flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Transaction" hideClose={true} />

      <div className="flex flex-col justify-center items-center self-center mt-10 mb-4 max-w-full w-[151px] gap-0.5">
        <img
          loading="lazy"
          src={chrome.runtime.getURL(
            `popup/${status === 'FAILED' ? 'pending' : type == 'SEND' ? 'sent' : 'received'}_icon.svg`,
          )}
          alt={statusAlt}
          className="object-contain w-6"
        />

        {preferences?.fiatCurrency === 'USD' && hasAmountUsd ? (
          <div className="text-[35px] leading-[53.2px] font-bold text-center text-white uppercase text-nowrap">
            {formatNumber(Math.abs(amountUsd ?? 0))} <span className="text-xl">USD</span>
          </div>
        ) : (
          <div className="text-[35px] leading-[53.2px] font-bold text-center text-white uppercase text-nowrap">
            {formatNumber(Math.abs(amountBtc), assetDigits)} <span className="text-xl">{meta.symbol}</span>
          </div>
        )}

        <div className="text-base font-bold leading-none text-white">{statusLabel}</div>

        {preferences?.fiatCurrency === 'USD' && hasAmountUsd ? (
          <span className="text-xs leading-loose text-foreground">
            {formatNumber(Math.abs(amountBtc), assetDigits)} {meta.symbol}
          </span>
        ) : (
          <span className="text-xs leading-loose text-foreground">
            {hasAmountUsd ? `${formatNumber(Math.abs(amountUsd ?? 0))} USD` : 'USD unavailable'}
          </span>
        )}
      </div>

      <div className="flex flex-col w-full gap-6 pt-4 pb-6 mt-4 border-t-[1px] border-t-background-5f">
        <LabelValue
          label="Amount"
          value={
            preferences?.fiatCurrency === 'USD' && hasAmountUsd
              ? `${formatNumber(Math.abs(amountUsd ?? 0))} USD (${formatNumber(Math.abs(amountBtc), assetDigits)} ${meta.symbol})`
              : `${formatNumber(Math.abs(amountBtc), assetDigits)} ${meta.symbol} (${hasAmountUsd ? `${formatNumber(Math.abs(amountUsd ?? 0))} USD` : 'USD unavailable'})`
          }
        />

        {type === 'SEND' && (
          <LabelValue
            label="Fee"
            value={
              preferences?.fiatCurrency === 'USD' && hasFeeUsd
                ? `${formatNumber(Math.abs(feeUsd ?? 0))} USD (${formatNumber(Math.abs(feeBtc), feeDigits)} ${feeSymbol})`
                : `${formatNumber(Math.abs(feeBtc), feeDigits)} ${feeSymbol} (${hasFeeUsd ? `${formatNumber(Math.abs(feeUsd ?? 0))} USD` : 'USD unavailable'})`
            }
          />
        )}

        {status !== 'PENDING' && <LabelValue label="Date & Time" value={formatTimestamp(timestamp)} />}
        <LabelValue
          label="Confirmations"
          value={
            <div
              className={`${status === 'FAILED' ? 'text-primary-red' : confirmations == 0 ? 'text-primary-orange' : 'text-primary-green'}`}>
              {status === 'FAILED'
                ? 'Failed'
                : confirmations == 0
                  ? 'Unconfirmed'
                  : `${formatNumber(confirmations)} Confirmations`}
            </div>
          }
        />
      </div>

      <div className="flex flex-col w-full gap-6 pt-4 pb-6 mt-4 border-t-[1px] border-t-background-5f">
        <LabelValue
          label="Transaction ID"
          value={
            <a href={explorerUrl} className="underline" target="_blank">
              {transactionHash}
            </a>
          }
        />
      </div>
    </div>
  );
};
