import type * as React from 'react';

export interface CryptoButtonProps {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export const CryptoButton: React.FC<CryptoButtonProps> = ({ icon, label, onClick, disabled = false }) => {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={e => !disabled && e.key === 'Enter' && onClick?.()}
      aria-disabled={disabled}
      className={`flex gap-2.5 justify-center items-center self-stretch px-2.5 py-3.5 my-auto rounded-2xl border border-solid min-h-[50px] w-[168px] ${
        disabled ? 'bg-zinc-900 border-stone-950 text-zinc-600 cursor-not-allowed' : 'bg-zinc-800 border-stone-900'
      }`}>
      <div className="flex flex-1 shrink gap-2 justify-center items-center self-stretch my-auto w-full basis-0">
        <img
          loading="lazy"
          src={chrome.runtime.getURL(icon)}
          alt={`${label} icon`}
          className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
        />
        <div className="self-stretch my-auto">{label}</div>
      </div>
    </div>
  );
};
