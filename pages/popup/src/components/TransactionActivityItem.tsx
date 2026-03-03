import type * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatNumber, timestampToTime, getStatusMeta } from '@src/utils';
import type { TxStatus, TxType } from '@extension/backend/src/types/cache';
import { useWalletContext } from '@src/context/WalletContext';

export interface TransactionActivityItemProps {
  type: TxType;
  status: TxStatus;
  amountBtc: number;
  amountUsd?: number;
  feeBtc: number;
  feeUsd?: number;
  timestamp: number;
  confirmations: number;
  transactionHash: string;
  sender: string;
  receiver: string;
  /** Currency unit label, defaults to 'BTC' */
  unit?: string;
  /** Decimal precision for the asset amount display */
  amountDecimals?: number;
  /** Network fee unit label when it differs from the asset unit */
  feeUnit?: string;
  /** Whether the network fee should be included in the top-line activity total */
  includeFeeInTotals?: boolean;
}

export const TransactionActivityItem: React.FC<TransactionActivityItemProps> = props => {
  const navigate = useNavigate();
  const { preferences } = useWalletContext();
  const selectedFiatCurrency = preferences.fiatCurrency;
  const unit = props.unit ?? 'BTC';
  const amountDecimals = props.amountDecimals ?? (unit === 'BTC' ? 8 : 6);
  const includeFeeInTotals = props.includeFeeInTotals ?? true;

  const isSent = props.type === 'SEND';
  const totalBtc = isSent && includeFeeInTotals ? props.amountBtc + props.feeBtc : props.amountBtc;
  const hasUsdAmount = Number.isFinite(props.amountUsd);
  const hasUsdFee = Number.isFinite(props.feeUsd);
  const totalUsd =
    hasUsdAmount && (!includeFeeInTotals || !isSent || hasUsdFee)
      ? (props.amountUsd ?? 0) + (isSent && includeFeeInTotals ? (props.feeUsd ?? 0) : 0)
      : undefined;
  const hasUsdTotal = Number.isFinite(totalUsd);
  const sign = isSent ? '-' : '+';
  const txnStatus =
    props.status === 'FAILED' ? 'failed' : props.status === 'PENDING' ? 'pending' : isSent ? 'sent' : 'received';
  const { icon, label } = getStatusMeta(txnStatus);
  const formattedTime = timestampToTime(props.timestamp);

  const handleClick = () => {
    navigate(`${props.transactionHash}/detail`, {
      state: {
        ...props,
        includeFeeInTotals,
      },
    });
  };

  return (
    <button
      tabIndex={0}
      onClick={handleClick}
      className="flex w-full items-center justify-between gap-2.5 px-4 py-3 rounded-xl h-[66px]
                 bg-background-2c hover:bg-zinc-700 cursor-pointer">
      <div className="flex items-center gap-2.5">
        <img
          loading="lazy"
          src={chrome.runtime.getURL(icon)}
          alt={`${label} icon`}
          className="object-contain w-6 h-6"
        />

        <div className="flex flex-col gap-0.5">
          <div className="flex flex-row items-center text-left gap-1 text-white">
            <span className="text-sm font-bold">{label}</span>
            {props.status !== 'PENDING' && <span className="text-xs">{formattedTime}</span>}
          </div>
          <span className="text-sm text-foreground-79 text-left w-[160px] truncate">{props.transactionHash}</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        {selectedFiatCurrency === 'USD' && hasUsdTotal ? (
          <>
            <span className="text-sm text-white text-nowrap">
              {sign}
              {formatNumber(Math.abs(totalUsd ?? 0))} USD
            </span>
            <span className="text-sm text-foreground-79 text-nowrap">
              {sign}
              {formatNumber(Math.abs(totalBtc), amountDecimals)} {unit}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm text-white text-nowrap">
              {sign}
              {formatNumber(Math.abs(totalBtc), amountDecimals)} {unit}
            </span>
            <span className="text-sm text-foreground-79 text-nowrap">
              {hasUsdTotal ? `${sign}${formatNumber(Math.abs(totalUsd ?? 0))} USD` : 'USD unavailable'}
            </span>
          </>
        )}
      </div>
    </button>
  );
};

export default TransactionActivityItem;
