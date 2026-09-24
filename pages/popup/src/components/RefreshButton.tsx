import type * as React from 'react';

interface RefreshButtonProps {
  refreshing: boolean;
  onClick: () => void;
  className?: string;
}

export const RefreshButton: React.FC<RefreshButtonProps> = ({ refreshing, onClick, className = '' }) => {
  return (
    <button
      type="button"
      aria-label={refreshing ? 'Refreshing balances' : 'Refresh balances'}
      title="Refresh"
      disabled={refreshing}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center size-5 disabled:cursor-default ${className}`}>
      <img
        loading="lazy"
        src={chrome.runtime.getURL('popup/refresh_icon.svg')}
        alt=""
        className={`object-contain size-5 ${refreshing ? 'animate-spin' : ''}`}
      />
    </button>
  );
};
