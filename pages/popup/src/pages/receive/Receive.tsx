import type React from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import AddressQRCode from '@src/components/AddressQRCode';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { useWalletContext } from '@src/context/WalletContext';
import { getCurrencyMeta } from '@src/utils/currencyMeta';
import type { Currencies } from '@src/types';
import { ChainType } from '@extension/backend/src/adapters/IChainAdapter';

export const Receive: React.FC = () => {
  const { getReceivingAddress, getChainReceivingAddress } = useWalletContext();
  const { currency } = useParams<{ currency: Currencies }>();
  const meta = getCurrencyMeta(currency);
  const [address, setAddress] = useState<string>('Address not found');
  const [copyText, setCopyText] = useState<string>('Copy address');

  useEffect(() => {
    (async () => {
      try {
        if (meta.chain === ChainType.Ethereum) {
          setAddress(await getChainReceivingAddress(meta.chain));
        } else {
          setAddress(await getReceivingAddress());
        }
      } catch (e) {
        console.error('Failed to get receiving address:', e);
        setAddress('Address not found');
      }
    })();
  }, [getReceivingAddress, getChainReceivingAddress, meta.chain]);

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
      <AddressQRCode currency={currency} address={address} />
      <Button tabIndex={0} onClick={handleCopyAddress} className="absolute w-full bottom-[19px]">
        <span>{copyText}</span>
      </Button>
    </div>
  );
};
