import { Button } from '@src/components/Button';
import { useWalletContext } from '@src/context/WalletContext';
import { buildTransactionExplorerUrl, isSupportedSendCurrency } from '@src/utils/currencyMeta';
import { currencyMapping, type Currencies } from '@src/types';
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

interface SendStatusStates {
  status?: 'success' | 'fail';
  transactionHash?: string;
}

export const SendStatus: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { preferences } = useWalletContext();

  const { currency } = useParams<{ currency: Currencies }>();
  const states = (location.state as SendStatusStates | null) ?? null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!currency) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!isSupportedSendCurrency(currency)) {
      navigate(`/dashboard/${currency}/activity`, { replace: true });
      return;
    }

    if (!states?.transactionHash || !states.status) {
      navigate(`/dashboard/${currency}/activity`, { replace: true });
    }
  }, [currency, navigate, states]);

  if (!currency || !isSupportedSendCurrency(currency) || !states?.transactionHash || !states.status) {
    return null;
  }

  const explorerUrl = buildTransactionExplorerUrl(currency, preferences.activeNetwork, states.transactionHash);

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(states.transactionHash!);

      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy transaction hash:', err);
    }
  };

  const handleDashboardClick = () => {
    navigate('/dashboard');
  };

  const handleRetryClick = () => {
    navigate(`/send/${currency}`);
  };

  const handleTransactionLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    // Open in a new browser tab so the extension UI can remain open.
    chrome.tabs.create({ url: explorerUrl, active: true });
  };

  return (
    <div className="relative flex flex-col items-center text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <div className="flex flex-col items-center w-[54px] mt-8">
        <img
          loading="lazy"
          src={chrome.runtime.getURL(`popup/send_${states.status}_anim.gif`)}
          alt="Transaction Status"
          className="object-contain aspect-[1.3] w-[78px] h-[70px]"
        />
      </div>
      <div className="mt-8 text-2xl font-bold leading-none text-center text-white">
        {currency ? currencyMapping[currency] : 'Unknown'} Sent
      </div>
      <div className="mt-5 text-lg leading-none text-center text-zinc-400">
        See the state of{' '}
        <a href={explorerUrl} onClick={handleTransactionLinkClick} className="text-primary-yellow cursor-pointer">
          your transaction
        </a>
      </div>
      <div className="mt-12 text-sm font-bold leading-none text-center text-white">Transaction ID</div>
      <div className="flex flex-col justify-center items-center gap-2 relative mt-2 max-w-[284px]">
        <button className="flex flex-center text-center" onClick={handleCopyToClipboard}>
          <div className="text-sm font-bold text-center text-foreground text-wrap break-all w-full">
            {states.transactionHash}
          </div>
          <img
            loading="lazy"
            src={chrome.runtime.getURL(`popup/copy_icon.svg`)}
            alt=""
            className="object-contain z-10 self-end mb-1 ml-[-20px] w-3 aspect-square"
          />
        </button>

        {copied && (
          <div className="w-14 p-1 bg-body font-normal bg-neutral-700 text-foreground text-xs rounded z-[1] text-center">
            Copied!
          </div>
        )}
      </div>

      {states.status === 'success' ? (
        <Button className="absolute w-full bottom-[19px]" onClick={handleDashboardClick}>
          Go to dashboard
        </Button>
      ) : (
        <Button className="absolute w-full bottom-[19px]" onClick={handleRetryClick}>
          Retry
        </Button>
      )}
    </div>
  );
};
