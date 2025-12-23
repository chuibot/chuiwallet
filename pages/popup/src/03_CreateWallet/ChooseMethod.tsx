import type React from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonOutline } from '@src/components/ButtonOutline';
import { sendMessage } from '@src/utils/bridge';
import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';

export const ChooseMethod: React.FC = () => {
  const navigate = useNavigate();

  const handleCreateNewWallet = async () => {
    try {
      const password = await getSessionPassword();
      await sendMessage('wallet.create', { password });
      navigate('/onboard/complete');
    } catch (err) {
      console.error('Failed to initiate wallet creation:', err);
    }
  };

  return (
    <div className="flex overflow-hidden flex-col justify-center items-center px-5 bg-dark h-full w-full gap-4">
      <ButtonOutline onClick={handleCreateNewWallet}>Create new wallet</ButtonOutline>
      <ButtonOutline onClick={() => navigate('/onboard/restore-seed')}>I already have a seed phrase</ButtonOutline>
    </div>
  );
};
