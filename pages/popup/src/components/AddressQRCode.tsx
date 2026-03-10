import type * as React from 'react';
import { currencyMapping, type Currencies } from '@src/types';
import { useState } from 'react';
import QRCode from 'react-qr-code';

interface AddressSectionProps {
  currency?: Currencies | undefined;
  address: string;
}

const AddressQRCode: React.FC<AddressSectionProps> = ({ currency, address }) => {
  const currencyName = currency ? currencyMapping[currency] : 'Unknown';
  const [copied, setCopied] = useState(false);

  const handleCopyToClipboard = async () => {
    try {
      if (!address) {
        console.error('Address not found');
        return;
      }

      await navigator.clipboard.writeText(address);

      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy seed:', err);
    }
  };

  // const handleGetNewAddress = async () => {
  //   nextAccount();
  // };

  return (
    <div className="flex flex-col items-center px-16 mt-8 w-full">
      <img
        loading="lazy"
        src={chrome.runtime.getURL(`popup/${currency ? currency : 'unknown'}_coin.svg`)}
        alt={currencyName}
        className="object-contain w-12 aspect-square"
      />

      <div className="mt-6 text-2xl font-bold leading-none text-center">{currencyName} address</div>

      <QRCode value={address} size={178} level="H" className="object-contain mt-8 max-w-full aspect-square w-[168px]" />

      <div className="relative mt-6 flex flex-col w-full max-w-[224px]">
        <button
          type="button"
          className="flex flex-start self-start text-[1rem] leading-5 text-center btc-address w-full"
          onClick={handleCopyToClipboard}>
          <span className="overflow-wrap text-wrap w-full text-left">{address}</span>
        </button>

        {copied && (
          <div className="absolute ml-1 mt-2 top-0 left-full p-1 bg-body font-normal bg-neutral-700 text-foreground text-xs rounded z-[1]">
            Copied!
          </div>
        )}
      </div>

      {/*<button*/}
      {/*  className="flex gap-0.5 justify-center items-center py-0.5 pr-0.5 mt-5 text-xs leading-6 text-primary-yellow"*/}
      {/*  onClick={handleGetNewAddress}>*/}
      {/*  <span className="self-stretch my-auto">Get a new address</span>*/}
      {/*  <img*/}
      {/*    loading="lazy"*/}
      {/*    src={chrome.runtime.getURL(`popup/refresh_icon.svg`)}*/}
      {/*    alt=""*/}
      {/*    className="object-contain shrink-0 self-stretch my-auto w-3 aspect-square"*/}
      {/*  />*/}
      {/*</button>*/}
    </div>
  );
};

export default AddressQRCode;
