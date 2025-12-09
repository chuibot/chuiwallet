import type React from 'react';
import { useState, useEffect } from 'react';
import { Dropdown } from './Dropdown';

type NetworkSelectorProps = {
  initialNetwork?: string;
  options?: string[];
  onChange?: (network: string) => void | Promise<void>;
};

const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  initialNetwork = 'Mainnet',
  options = ['Mainnet', 'Testnet'],
  onChange,
}) => {
  const [selectedNetwork, setSelectedNetwork] = useState(initialNetwork);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (network: string) => {
    setIsLoading(true);
    setError(null);
    setIsSuccessful(false);

    try {
      if (onChange) {
        await Promise.resolve(onChange(network));
      }

      // Simulate minimum loading time for smooth UX
      await new Promise(resolve => setTimeout(resolve, 500));

      setSelectedNetwork(network);

      // Show success state
      setIsSuccessful(true);
      setTimeout(() => setIsSuccessful(false), 1000);
    } catch (error) {
      console.error('Failed to change network:', error);
      setError(error instanceof Error ? error.message : 'Failed to switch network');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSelectedNetwork(initialNetwork);
  }, [initialNetwork]);

  // Auto-hide error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div className="relative flex flex-col justify-center w-full gap-[2px]">
      <div className="text-base leading-[22px] text-white font-bold mt-[8px]">BTC Network</div>
      <Dropdown
        options={options}
        selected={selectedNetwork}
        isLoading={isLoading}
        isSuccessful={isSuccessful}
        onSelect={handleSelect}
      />
      {error && (
        <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/50 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
};

export default NetworkSelector;
