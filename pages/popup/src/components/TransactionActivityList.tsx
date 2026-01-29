import type * as React from 'react';
import type { TxEntry } from '@extension/backend/src/types/cache';
import { TransactionActivityItem } from './TransactionActivityItem';
import { useEffect, useRef, useState } from 'react';

interface TransactionActivityListProps {
  transactions: TxEntry[];
}

/**
 * Group transactions into two groups:
 *  - pending: all transactions with status 'PENDING'
 *  - confirmed: transactions with status 'CONFIRMED' grouped by date (YYYY-MM-DD)
 */
function groupTransactions(transactions: TxEntry[]) {
  const pending: TxEntry[] = [];
  const confirmed: Record<string, TxEntry[]> = {};

  transactions.forEach(tx => {
    if (tx.status === 'PENDING') {
      pending.push(tx);
    } else {
      const date = new Date(tx.timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      if (!confirmed[dateKey]) {
        confirmed[dateKey] = [];
      }
      confirmed[dateKey].push(tx);
    }
  });
  return { pending, confirmed };
}

function formatDateLabel(date: Date): string {
  const now = new Date();
  if (
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate()
  ) {
    return 'Today';
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export const TransactionActivityList: React.FC<TransactionActivityListProps> = ({ transactions }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const { pending, confirmed } = groupTransactions(transactions);

  const confirmedGroups = Object.entries(confirmed).sort((a, b) => {
    return new Date(b[0]).getTime() - new Date(a[0]).getTime();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setIsScrollable(container.scrollHeight > container.clientHeight);
    }
  }, [transactions.length]);

  if (transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-356px)] text-gray-400 text-base">
        No transaction activities yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col gap-2 overflow-y-auto h-[calc(100vh-356px)]
      [&::-webkit-scrollbar]:w-2
      [&::-webkit-scrollbar-track]:rounded-full
      [&::-webkit-scrollbar-track]:transparent
      [&::-webkit-scrollbar-thumb]:rounded-full
      [&::-webkit-scrollbar-thumb]:bg-neutral-700
      ${isScrollable ? 'mr-[-8px] overflow-x-visible' : 'w-full'}`}>
      {pending.length > 0 && (
        <div>
          <div className="text-gray-400 text-xs text-right pr-1 mb-2">Upcoming</div>
          <div className="flex flex-col gap-2">
            {pending
              .sort((a, b) => b.timestamp - a.timestamp)
              .map(tx => (
                <TransactionActivityItem
                  key={tx.transactionHash}
                  type={tx.type}
                  status={tx.status}
                  amountBtc={tx.amountBtc}
                  amountUsd={tx.amountUsd}
                  feeBtc={tx.feeBtc}
                  feeUsd={tx.feeUsd}
                  timestamp={tx.timestamp}
                  confirmations={tx.confirmations}
                  transactionHash={tx.transactionHash}
                  sender={tx.sender}
                  receiver={tx.receiver}
                />
              ))}
          </div>
        </div>
      )}

      {confirmedGroups.map(([dateKey, txs]) => {
        const dateObj = new Date(dateKey);
        const dateLabel = formatDateLabel(dateObj);
        return (
          <div key={dateKey}>
            <div className="text-gray-400 text-xs text-right pr-1 mb-2">{dateLabel}</div>
            <div className="flex flex-col gap-2">
              {txs
                .sort((a, b) => b.timestamp - a.timestamp)
                .map(transaction => (
                  <TransactionActivityItem
                    key={transaction.transactionHash}
                    type={transaction.type}
                    status={transaction.status}
                    amountBtc={transaction.amountBtc}
                    amountUsd={transaction.amountUsd}
                    feeBtc={transaction.feeBtc}
                    feeUsd={transaction.feeUsd}
                    timestamp={transaction.timestamp}
                    confirmations={transaction.confirmations}
                    transactionHash={transaction.transactionHash}
                    sender={transaction.sender}
                    receiver={transaction.receiver}
                  />
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TransactionActivityList;
