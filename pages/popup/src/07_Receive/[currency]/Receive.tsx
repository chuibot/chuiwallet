import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; // Added useNavigate
import AddressQRCode from '@src/components/AddressQRCode';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { useWalletContext } from '@src/context/WalletContext';
import type { Currencies } from '@src/types';

export const Receive: React.FC = () => {
  const navigate = useNavigate();
  const { getReceivingAddress, isBackedUp } = useWalletContext();
  const { currency } = useParams<{ currency: Currencies }>();
  const [address, setAddress] = useState<string>('Address not found');
  const [copyText, setCopyText] = useState<string>('Copy address');

  useEffect(() => {
    (async () => {
      setAddress(await getReceivingAddress());
    })();
  }, [getReceivingAddress]);

  const handleCopyAddress = async () => {
    try {
      if (!address) return;
      await navigator.clipboard.writeText(address);
      setCopyText('Copied!');
      setTimeout(() => setCopyText('Copy address'), 3000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="relative flex overflow-hidden flex-col text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Receive" />

      {!isBackedUp && (
        <button
          onClick={() => navigate('/settings/advanced/unlock-seed')}
          className="flex items-center justify-center gap-2 mt-2 mb-4 hover:opacity-80 transition-opacity cursor-pointer mx-auto">
          <div className="flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500 text-black text-[10px] font-bold">
            !
          </div>
          <span className="text-sm font-medium text-yellow-500">Wallet not backed up</span>
        </button>
      )}

      <AddressQRCode currency={currency} address={address} />
      <Button tabIndex={0} onClick={handleCopyAddress} className="absolute w-full bottom-[19px]">
        <span>{copyText}</span>
      </Button>
    </div>
  );
};
