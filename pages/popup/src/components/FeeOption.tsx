import { capitalizeFirstLetter } from '@src/utils';
import { formatFeeAmount, formatFeeRate, formatFiatValue } from '@src/utils/sendFormatting';
import type * as React from 'react';

export interface FeeOptionProps {
  name?: string;
  fee: number;
  fiatAmount?: number;
  rateValue?: number;
  rateUnit?: string;
  symbol: string;
  selected: boolean;
  onSelect?: () => void;
}

export const FeeOption: React.FC<FeeOptionProps> = ({
  name,
  fee,
  fiatAmount,
  rateValue,
  rateUnit,
  symbol,
  selected,
  onSelect,
}) => {
  const iconVariant = (name ?? 'Medium').toLowerCase();
  const formattedRate = formatFeeRate(rateValue, rateUnit);
  const showsRateOnly = rateUnit === 'gwei';
  const primaryValue = showsRateOnly ? (formattedRate ?? 'Fee unavailable') : formatFeeAmount(fee, symbol);

  return (
    <button
      onClick={onSelect}
      className={`flex flex-col justify-center items-center px-auto rounded-2xl border border-solid h-[110px] min-h-[110px] w-[110px] gap-1 cursor-pointer 
        ${selected ? 'bg-background-14 border-primary-yellow' : 'bg-background-2c border-background-1d'}`}>
      <div className="w-full flex justify-center">
        <img
          loading="lazy"
          src={chrome.runtime.getURL(`popup/fee_${iconVariant}_icon.svg`)}
          alt=""
          className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
        />
      </div>
      <div className="w-full text-sm font-medium whitespace-nowrap text-zinc-500">
        {name ? capitalizeFirstLetter(name) : 'Medium'}
      </div>
      <div className="flex flex-col items-center w-full text-xs text-white gap-1">
        <div>{primaryValue}</div>
        <div>{formatFiatValue(fiatAmount)}</div>
        {!showsRateOnly && formattedRate && <div className="text-[10px] text-foreground-79">{formattedRate}</div>}
      </div>
    </button>
  );
};
