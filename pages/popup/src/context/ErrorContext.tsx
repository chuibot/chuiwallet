import type { ReactNode } from 'react';
import type React from 'react';
import { createContext, useContext, useState, useCallback } from 'react';

interface ErrorContextType {
  error: string | null;
  showError: (message: string) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    console.error('Error:', message);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return <ErrorContext.Provider value={{ error, showError, clearError }}>{children}</ErrorContext.Provider>;
};

export const useError = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return context;
};
