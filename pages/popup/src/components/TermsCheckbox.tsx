import * as React from 'react';

const TERMS_URL = 'https://chuiwallet.com/terms';
const PRIVACY_URL = 'https://chuiwallet.com/privacy';

export interface TermsCheckboxProps {
  onAcceptChange: (accepted: boolean) => void;
  onBeforeTosOpen?: () => Promise<void>;
  initialChecked?: boolean;
}

interface CheckRowProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}

const CheckRow: React.FC<CheckRowProps> = ({ id, checked, onChange, children }) => (
  <div className="flex gap-2 items-start">
    <div className="relative shrink-0 h-6">
      <input
        type="checkbox"
        id={id}
        onChange={e => onChange(e.target.checked)}
        checked={checked}
        className="appearance-none shrink-0 w-6 h-6 cursor-pointer"
      />
      <svg
        className={`pointer-events-none absolute top-[8px] left-[7px] w-[10px] h-[8px] transition-opacity duration-150 ${checked ? 'opacity-100' : 'opacity-0'}`}
        width="10"
        height="8"
        viewBox="0 0 10 8"
        fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <path
          d="M4.30346 5.06608L8.19676 1.17277L8.89591 1.88441L3.9499 6.83042L1.11015 3.99067L1.82179 3.29152L3.59635 5.06608L3.9499 5.41963L4.30346 5.06608Z"
          fill="#424242"
          stroke="black"
        />
      </svg>
    </div>
    <label htmlFor={id} className="pt-0.5 text-white cursor-pointer">
      {children}
    </label>
  </div>
);

export const TermsCheckbox: React.FC<TermsCheckboxProps> = ({
  onAcceptChange,
  onBeforeTosOpen,
  initialChecked = false,
}) => {
  const [termsChecked, setTermsChecked] = React.useState(initialChecked);
  const [custodyChecked, setCustodyChecked] = React.useState(initialChecked);

  const handleTermsChange = (value: boolean) => {
    setTermsChecked(value);
    onAcceptChange(value && custodyChecked);
  };

  const handleCustodyChange = (value: boolean) => {
    setCustodyChecked(value);
    onAcceptChange(value && termsChecked);
  };

  const handleTosClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onBeforeTosOpen) {
      e.preventDefault();
      const href = e.currentTarget.href;
      await onBeforeTosOpen();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full text-xs font-normal leading-5">
      <CheckRow id="terms" checked={termsChecked} onChange={handleTermsChange}>
        I agree to the{' '}
        <a
          href={TERMS_URL}
          className="text-primary-yellow no-underline"
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleTosClick}>
          Chui Wallet EULA and Terms of Use
        </a>
        .
      </CheckRow>

      <div className="flex flex-col">
        <a
          href={PRIVACY_URL}
          className="w-fit text-primary-yellow no-underline"
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleTosClick}>
          Privacy Notice
        </a>
        <span className="text-neutral-400">Read how Chui handles information.</span>
      </div>

      <CheckRow id="self-custody" checked={custodyChecked} onChange={handleCustodyChange}>
        I understand that Chui is self-custodial. OneByZero cannot recover my recovery phrase or private keys, restore
        access to my wallet, or reverse blockchain transactions.
      </CheckRow>
    </div>
  );
};
