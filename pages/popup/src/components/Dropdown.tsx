import type React from 'react';
import { useState, useRef, useEffect } from 'react';

interface DropdownProps {
  options: string[];
  onSelect: (option: string) => void | Promise<void>;
  selected?: string;
  isLoading?: boolean;
  isSuccessful?: boolean;
  label?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  onSelect,
  selected,
  isLoading = false,
  isSuccessful = false,
  label = 'Select option',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => setIsOpen(!isOpen);

  const handleSelect = async (opt: string) => {
    setIsOpen(false);
    await Promise.resolve(onSelect(opt));
  };

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
    <div ref={containerRef} className="relative w-full text-lg">
      <button
        type="button"
        onClick={toggleDropdown}
        className="flex gap-2.5 justify-center items-center px-5 py-3 w-full rounded-2xl bg-background-1d border border-background-42">
        {isLoading ? (
          <div className="flex items-center justify-center w-full p-1">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : isSuccessful ? (
          <div className="flex items-center justify-center w-full">
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <span className="self-stretch my-auto w-full text-left text-foreground-1 text-white font-normal">
            {selected ?? label}
          </span>
        )}
        <img
          loading="lazy"
          src={chrome.runtime.getURL('popup/dropdown_arrow_icon.svg')}
          alt="Dropdown arrow"
          className={`object-contain shrink-0 self-stretch my-auto w-2.5 aspect-[0.91] transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      <div
        className={`absolute flex flex-col z-10 mt-0.5 w-full bg-background-1d border border-background-42 rounded-2xl 
          transition-all duration-200 
          ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => handleSelect(opt)}
            className="w-full text-left text-white font-normal hover:bg-background-42 text-base px-5 py-3 first:rounded-t-2xl last:rounded-b-2xl">
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
};
