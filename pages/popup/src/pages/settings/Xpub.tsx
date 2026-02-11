import type React from 'react';
import { useEffect, useState } from 'react';
import Header from '@src/components/Header';
import { Button } from '@src/components/Button';
import XpubQRCode from '@src/components/XpubQRCode';
import { sendMessage } from '@src/utils/bridge';

export const Xpub: React.FC = () => {
  const [xpub, setXpub] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [copyText, setCopyText] = useState<string>('Copy To Clipboard');

  const fetchXpub = async () => {
    setLoading(true);
    setError('');
    try {
      const xpub: string = await sendMessage('wallet.getXpub');
      setXpub(xpub);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch xPub key');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchXpub();
  }, []);

  const handleCopyToClipboard = async () => {
    try {
      if (!xpub) {
        console.error('xPub not found');
        return;
      }

      await navigator.clipboard.writeText(xpub);

      setCopyText('Copied!');
      setTimeout(() => {
        setCopyText('Copy To Clipboard');
      }, 3000);
    } catch (err) {
      console.error('Failed to copy seed:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-dark text-white px-5 pt-12 pb-[19px]">
      <Header title="Wallet xPub" />
      <div className="flex flex-col flex-1 items-center justify-center">
        {loading ? (
          <div className="text-lg">Loading...</div>
        ) : error ? (
          <div className="text-lg text-primary-red">Error: {error}</div>
        ) : xpub ? (
          <>
            <XpubQRCode xpub={xpub} currency="btc" />
          </>
        ) : (
          <div className="text-lg">No xPub key available.</div>
        )}
      </div>
      <Button onClick={handleCopyToClipboard} disabled={loading}>
        {copyText}
      </Button>
    </div>
  );
};

export default Xpub;
