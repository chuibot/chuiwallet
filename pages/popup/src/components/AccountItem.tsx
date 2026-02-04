import type * as React from 'react';
import Avvvatars from 'avvvatars-react';
import Skeleton from 'react-loading-skeleton';

interface AccountItemProps {
  accountName: string;
  address: string;
  amount: string;
  selected: boolean;
  isLoading: boolean | null;
  onClick?: () => void;
  dataTestId?: string;
}

const AccountItem: React.FC<AccountItemProps> = ({
  accountName,
  address,
  amount,
  selected,
  isLoading = false,
  onClick,
  dataTestId,
}) => {
  return (
    <button
      className={`flex gap-3 justify-center items-center px-2.5 py-3 w-full rounded-lg ${
        selected ? 'bg-background-2c' : ''
      } hover:bg-background-2c max-w-[346px]`}
      onClick={onClick}
      data-testid={dataTestId}>
      <div className="flex gap-3 items-center self-stretch my-auto min-w-[240px] w-[312px]">
        {isLoading ? (
          <Skeleton circle={true} className="!w-[48px] !h-[46px]" />
        ) : (
          <Avvvatars value={address} style="shape" size={48} />
        )}

        <div className="flex flex-col flex-1 items-start shrink self-stretch my-auto basis-0 min-w-[240px]">
          <div className="flex justify-between items-center w-full text-base font-bold leading-none text-white">
            <div className="gap-1 self-stretch text-left my-auto w-[120px]">{accountName}</div>
          </div>
          {isLoading ? (
            <Skeleton className="mt-1.5 !w-[80px] !h-[14px]" />
          ) : (
            <>
              <div className="gap-1 mt-1.5 w-full text-sm leading-none text-left text-foreground">{amount}</div>
            </>
          )}
        </div>
      </div>
    </button>
  );
};

export default AccountItem;
