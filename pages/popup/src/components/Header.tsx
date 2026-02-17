import type * as React from 'react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title: React.ReactNode;
  hideClose?: boolean;
  onBack?: () => void;
}

const Header: React.FC<HeaderProps> = ({ title, hideClose = false, onBack }) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  const handleClose = () => {
    navigate('/dashboard');
  };

  return (
    <div className="absolute top-0 left-0 w-full min-h-[48px] flex gap-5 justify-between items-center p-3 text-xl leading-none text-center whitespace-nowrap bg-dark">
      <button onClick={handleBack}>
        <img
          loading="lazy"
          src={chrome.runtime.getURL(`popup/back_icon.svg`)}
          alt=""
          className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
        />
      </button>

      <div className="self-stretch w-[262px] font-bold leading-6 text-white">{title}</div>

      <button onClick={handleClose} disabled={hideClose} className={!hideClose ? '' : 'opacity-0'}>
        <img
          loading="lazy"
          src={chrome.runtime.getURL(`popup/close_icon.svg`)}
          alt=""
          className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
        />
      </button>
    </div>
  );
};

export default Header;
