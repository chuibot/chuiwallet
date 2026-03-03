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
  amountUsd: number;
  feeBtc: number;
  feeUsd: number;
  timestamp: number;
  confirmations: number;
  transactionHash: string;
  sender: string;
  receiver: string;
}

export const TransactionDetail: React.FC = () => {
  const { preferences } = useWalletContext();
  const location = useLocation();
  const { currency } = useParams<{ currency: Currencies }>();
  const meta = getCurrencyMeta(currency);
  const assetDigits = getAssetDisplayPrecision(currency);

  const transactionDetailStates = location.state as TransactionDetailStates;
  const { type, status, amountBtc, amountUsd, feeBtc, feeUsd, timestamp, confirmations, transactionHash } =
    transactionDetailStates;
  const explorerUrl = buildTransactionExplorerUrl(currency, preferences.activeNetwork, transactionHash);

  return (
    <div className="flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Transaction" hideClose={true} />

      <div className="flex flex-col justify-center items-center self-center mt-10 mb-4 max-w-full w-[151px] gap-0.5">
        <img
          loading="lazy"
          src={chrome.runtime.getURL(`popup/${type == 'SEND' ? 'sent' : 'received'}_icon.svg`)}
          alt={status == 'CONFIRMED' ? (type == 'SEND' ? 'Sent' : 'Received') : 'Pending'}
          className="object-contain w-6"
        />

        {preferences?.fiatCurrency === 'USD' ? (
          <div className="text-[35px] leading-[53.2px] font-bold text-center text-white uppercase text-nowrap">
            {formatNumber(Math.abs(amountUsd))} <span className="text-xl">USD</span>
          </div>
        ) : (
          <div className="text-[35px] leading-[53.2px] font-bold text-center text-white uppercase text-nowrap">
            {formatNumber(Math.abs(amountBtc), assetDigits)} <span className="text-xl">{meta.symbol}</span>
          </div>
        )}

        <div className="text-base font-bold leading-none text-white">
          {status == 'CONFIRMED' ? (type == 'SEND' ? 'Sent' : 'Received') : 'Pending'}
        </div>

        {preferences?.fiatCurrency === 'USD' ? (
          <span className="text-xs leading-loose text-foreground">
            {formatNumber(Math.abs(amountBtc), assetDigits)} {meta.symbol}
          </span>
        ) : (
          <span className="text-xs leading-loose text-foreground">{formatNumber(Math.abs(amountUsd))} USD</span>
        )}
      </div>

      <div className="flex flex-col w-full gap-6 pt-4 pb-6 mt-4 border-t-[1px] border-t-background-5f">
        <LabelValue
          label="Amount"
          value={
            preferences?.fiatCurrency === 'USD'
              ? `${formatNumber(Math.abs(amountUsd))} USD (${formatNumber(Math.abs(amountBtc), assetDigits)} ${meta.symbol})`
              : `${formatNumber(Math.abs(amountBtc), assetDigits)} ${meta.symbol} (${formatNumber(Math.abs(amountUsd))} USD)`
          }
        />

        {type === 'SEND' && (
          <LabelValue
            label="Fee"
            value={
              preferences?.fiatCurrency === 'USD'
                ? `${formatNumber(Math.abs(feeUsd))} USD (${formatNumber(Math.abs(feeBtc), assetDigits)} ${meta.symbol})`
                : `${formatNumber(Math.abs(feeBtc), assetDigits)} ${meta.symbol} (${formatNumber(Math.abs(feeUsd))} USD)`
            }
          />
        )}

        {status == 'CONFIRMED' && <LabelValue label="Date & Time" value={formatTimestamp(timestamp)} />}
        <LabelValue
          label="Confirmations"
          value={
            <div className={`${confirmations == 0 ? 'text-primary-orange' : 'text-primary-green'}`}>
              {confirmations == 0 ? 'Unconfirmed' : `${formatNumber(confirmations)} Confirmations`}
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
