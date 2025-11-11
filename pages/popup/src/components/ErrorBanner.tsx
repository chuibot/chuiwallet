import type React from 'react';
import { useError } from '../context/ErrorContext';

export const ErrorBanner: React.FC = () => {
  const { error, clearError } = useError();

  if (!error) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-slideDown">
      <div className="bg-red-600 text-white px-4 py-3 shadow-lg">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <img
              loading="lazy"
              src={chrome.runtime.getURL('popup/x_circle_icon_white.svg')}
              alt="x circle icon"
              className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
            />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <button
            onClick={clearError}
            className="text-white hover:text-red-200 transition-colors flex-shrink-0"
            aria-label="Close">
            <img
              loading="lazy"
              src={chrome.runtime.getURL('popup/x_icon_white.svg')}
              alt="x icon"
              className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
            />
          </button>
        </div>
      </div>
    </div>
  );
};
