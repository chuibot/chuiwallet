import type React from 'react';
import { useBanner } from '../context/BannerContext';

const BANNER_STYLES = {
  error: 'bg-red-600',
  warning: 'bg-yellow-600',
  info: 'bg-blue-600',
  success: 'bg-green-600',
} as const;

const BANNER_ICONS = {
  error: 'popup/explamation_mark_icon_white.svg',
  warning: 'popup/explamation_mark_icon_white.svg',
  info: 'popup/info_icon_white.svg',
  success: 'popup/check_icon_white.svg',
} as const;

export const Banner: React.FC<{ isCloseable?: boolean }> = ({ isCloseable = true }) => {
  const { banner, clearBanner } = useBanner();

  if (!banner) return null;

  const bgColor = BANNER_STYLES[banner.type];
  const icon = BANNER_ICONS[banner.type];

  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-slideDown">
      <div className={`${bgColor} text-white px-4 py-3 shadow-lg`}>
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <img
              loading="lazy"
              src={chrome.runtime.getURL(icon)}
              alt="banner icon"
              className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
            />
            <span className="text-sm font-medium">{banner.message}</span>
          </div>
          {isCloseable && (
            <button
              onClick={clearBanner}
              className="text-white hover:opacity-80 transition-opacity flex-shrink-0"
              aria-label="Close">
              <img
                loading="lazy"
                src={chrome.runtime.getURL('popup/x_icon_white.svg')}
                alt="x icon"
                className="object-contain shrink-0 self-stretch my-auto w-6 aspect-square"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
