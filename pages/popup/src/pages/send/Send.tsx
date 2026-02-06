import { AddressInputField } from '@src/components/AddressInputField';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { currencyMapping, type Currencies } from '@src/types';
import { isValidBTCAddress } from '@src/utils';
import type * as React from 'react';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useWalletContext } from '@src/context/WalletContext';

interface SendState {
  balance: number;
}

export const Send: React.FC = () => {
  const navigate = useNavigate();
  const { preferences } = useWalletContext();
  const location = useLocation();
  const { currency } = useParams<{ currency: Currencies }>();
  const states = location.state as SendState;

  const [destinationAddress, setDestinationAddress] = useState('');
  const [error, setError] = useState('');

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDestinationAddress(value);
    if (isValidBTCAddress(value, preferences.activeNetwork)) {
      setError('');
    }
  };

  const handleNext = () => {
    if (!isValidBTCAddress(destinationAddress, preferences!.activeNetwork)) {
      setError('Please enter a valid BTC address');
      return;
    }
    navigate('options', {
      state: {
        destinationAddress,
        balance: states.balance,
      },
    });
  };

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title={`Send ${currencyMapping[currency!]}`} />

      <img
        loading="lazy"
        src={chrome.runtime.getURL(`popup/${currency ? currency : 'unknown'}_coin.svg`)}
        alt=""
        className="object-contain mt-14 w-12 aspect-square"
      />

      <div className="mt-14 w-full text-lg font-bold relative">
        <AddressInputField
          label="Destination address"
          type="text"
          placeholder=""
          id="destinationAddress"
          value={destinationAddress}
          onChange={handleAddressChange}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleNext();
            }
          }}
        />
        <p className="mt-2 text-xs text-primary-red font-normal h-[20px]">{error}</p>
      </div>

      <Button className="absolute w-full bottom-[19px]" onClick={handleNext}>
        Next
      </Button>
    </div>
  );
};
