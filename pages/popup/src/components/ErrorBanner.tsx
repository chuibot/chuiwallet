// src/components/ErrorBanner.tsx
import type React from 'react';
import { useError } from '../context/ErrorContext';

export const ErrorBanner: React.FC = () => {
  const { error, clearError } = useError();

  if (!error) return null;

  return (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
      <div className="flex justify-between items-center">
        <span>{error}</span>
        <button onClick={clearError} className="font-bold text-xl">
          ×
        </button>
      </div>
    </div>
  );
};
