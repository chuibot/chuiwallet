import type { ReactNode } from 'react';
import type React from 'react';
import { createContext, useContext, useState, useCallback } from 'react';

interface ErrorContextType {
  errorMessage: string | null;
  setErrorMessage: (message: string) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  return (
    <ErrorContext.Provider value={{ errorMessage, setErrorMessage, clearError }}>{children}</ErrorContext.Provider>
  );
};

export const useErrorContext = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return context;
};
