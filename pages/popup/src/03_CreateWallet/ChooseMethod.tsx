import type React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonOutline } from '@src/components/ButtonOutline';
import { sendMessage } from '@src/utils/bridge';
import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { ERROR_MESSAGES } from '@src/constants';

export const ChooseMethod: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const handleCreateNewWallet = async () => {
    try {
      setError(null);
      const password = await getSessionPassword();
      if (!password) {
        setError(ERROR_MESSAGES.PASSWORD_NOT_FOUND);
        return;
      }

      await sendMessage('wallet.create', { password });
      navigate('/onboard/complete');
    } catch (err) {
      console.error('Failed to initiate wallet creation:', err);
      const errorMessage = err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
      setError(errorMessage);
    }
  };

  return (
    <div className="flex overflow-hidden flex-col justify-center items-center px-5 bg-dark h-full w-full gap-4">
      {error && (
        <div className="w-full max-w-sm px-4 py-3 bg-red-500/10 border border-red-500 rounded-lg">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      <ButtonOutline onClick={handleCreateNewWallet}>Create new wallet</ButtonOutline>
      <ButtonOutline onClick={() => navigate('/onboard/restore-seed')}>I already have a seed phrase</ButtonOutline>
    </div>
  );
};
