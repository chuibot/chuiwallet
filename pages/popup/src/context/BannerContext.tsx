import type { ReactNode } from 'react';
import type React from 'react';
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { BANNER_DURATIONS, type BannerType } from '@src/constants';

interface Banner {
  message: string;
  type: BannerType;
}

interface BannerContextType {
  banner: Banner | null;
  showBanner: (message: string, type: BannerType, duration?: number) => void;
  clearBanner: () => void;
}

const BannerContext = createContext<BannerContextType | undefined>(undefined);

export const BannerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [banner, setBanner] = useState<Banner | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearBanner = useCallback(() => {
    setBanner(null);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const showBanner = useCallback((message: string, type: BannerType, duration?: number) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setBanner({ message, type });

    // Use provided duration, or default based on type
    const autoDismissDuration =
      duration ?? BANNER_DURATIONS[type.toUpperCase() as keyof typeof BANNER_DURATIONS] ?? BANNER_DURATIONS.DEFAULT;

    if (autoDismissDuration > 0) {
      timeoutRef.current = setTimeout(() => {
        setBanner(null);
        timeoutRef.current = null;
      }, autoDismissDuration);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return <BannerContext.Provider value={{ banner, showBanner, clearBanner }}>{children}</BannerContext.Provider>;
};

export const useBanner = () => {
  const context = useContext(BannerContext);
  if (!context) {
    throw new Error('useBanner must be used within BannerProvider');
  }
  return context;
};
