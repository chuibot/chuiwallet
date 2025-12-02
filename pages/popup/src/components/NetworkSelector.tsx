import type React from 'react';
import { useState, useRef, useEffect } from 'react';

type NetworkSelectorProps = {
  initialNetwork?: string;
  options?: string[];
  onChange?: (network: string) => void;
};

const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  initialNetwork = 'Mainnet',
  options = ['Mainnet', 'Testnet'],
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(initialNetwork);
  const [isLoading, setIsLoading] = useState(false);
  const [shouldShowCheckMark, setShouldShowCheckMark] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = async (selected: string) => {
    setIsLoading(true);
    setIsOpen(false);

    if (onChange) {
      await onChange(selected);
    }
    // TODO: Add logic and UI for if switching networks fails

    // Simulate minimum loading time for smooth UX
    await new Promise(resolve => setTimeout(resolve, 500));

    setSelectedNetwork(selected);
    setIsLoading(false);
    setShouldShowCheckMark(true);

    // Hide checkmark after 1 second
    setTimeout(() => setShouldShowCheckMark(false), 1000);
  };

  useEffect(() => {
    setSelectedNetwork(initialNetwork);
  }, [initialNetwork]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative flex flex-col justify-center w-full gap-[2px]" ref={containerRef}>
      <div className="text-base leading-[22px] text-white font-bold mt-[8px]">BTC Network</div>
      <div className="flex flex-col w-full text-lg leading-8 whitespace-nowrap text-foreground-79">
        <button
          type="button"
          onClick={toggleDropdown}
          className="flex gap-2.5 justify-center items-center px-5 py-3 w-full rounded-2xl bg-background-1d border border-background-42">
          {isLoading ? (
            <div className="flex items-center justify-center w-full p-1">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : shouldShowCheckMark ? (
            <div className="flex items-center justify-center w-full">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <span className="self-stretch my-auto w-full text-left text-foreground-1 text-md text-white font-normal">
              {selectedNetwork}
            </span>
          )}
          <img
            loading="lazy"
            src={chrome.runtime.getURL('popup/dropdown_arrow_icon.svg')}
            alt="Dropdown arrow"
            className={`object-contain shrink-0 self-stretch my-auto w-2.5 aspect-[0.91] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <div
          className={`absolute flex flex-col z-10 mt-[60px] w-full bg-background-1d border border-background-42 rounded-2xl 
            transition-all duration-200 
            ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelect(opt)}
              className="w-full text-left text-white font-normal hover:bg-background-42 text-md px-[44px] py-2 rounded-lg">
              {opt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NetworkSelector;
