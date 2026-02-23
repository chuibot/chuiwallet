import * as React from 'react';

export interface TermsCheckboxProps {
  onAcceptChange: (accepted: boolean) => void;
}

export const TermsCheckbox: React.FC<TermsCheckboxProps> = ({ onAcceptChange }) => {
  const [checked, setChecked] = React.useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    setChecked(newValue);
    onAcceptChange(newValue);
  };

  return (
    <div className="flex gap-3 items-center w-full text-xs leading-6">
      <div className="flex gap-2 items-center">
        <div className="relative h-6">
          <input
            type="checkbox"
            id="terms"
            onChange={handleChange}
            checked={checked}
            className="appearance-none shrink-0 w-6 h-6 cursor-pointer"
          />
          <svg
            className={`pointer-events-none absolute top-[8px] left-[7px] w-[10px] h-[8px] text-[424242] transition-opacity duration-150 ${checked ? 'opacity-100' : 'opacity-0'}`}
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
        <label htmlFor="terms" className="flex gap-1 items-center cursor-pointer">
          <span className="text-white">I accept the</span>
          <a
            href="https://www.blockonomics.co/privacy"
            className="text-primary-yellow no-underline"
            target="_blank"
            rel="noopener noreferrer">
            Terms of Service
          </a>
        </label>
      </div>
    </div>
  );
};
