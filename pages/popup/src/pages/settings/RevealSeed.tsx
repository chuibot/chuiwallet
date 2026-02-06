import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SeedColumn } from '@src/components/SeedColumn';
import { Button } from '@src/components/Button';
import Header from '@src/components/Header';
import { sendMessage } from '@src/utils/bridge';
import { useWalletContext } from '@src/context/WalletContext';

export const RevealSeed: React.FC = () => {
  const navigate = useNavigate();
  const { isBackedUp } = useWalletContext();
  const [leftColumnWords, setLeftColumnWords] = useState<string[]>([]);
  const [rightColumnWords, setRightColumnWords] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const mnemonic: string = await sendMessage('wallet.getMnemonic');
        setSeed(mnemonic);
        if (mnemonic) {
          const words = mnemonic.split(' ');
          if (words.length !== 12) {
            console.error('Expected 12 words, got', words.length);
          }
          setLeftColumnWords(words.slice(0, 6));
          setRightColumnWords(words.slice(6, 12));
        }
      } catch (err) {
        console.error('Error recovering seed:', err);
      }
    })();
  }, []);

  const handleCopyToClipboard = async () => {
    try {
      if (!seed) {
        console.error('Failed to recover seed');
        return;
      }
      await navigator.clipboard.writeText(seed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy seed:', err);
    }
  };

  return (
    <div className="relative flex flex-col text-white bg-dark h-full px-4 pt-12 pb-[19px]">
      <Header title="Seed phrase" hideClose={true} />
      <div className="mt-[20px] flex flex-col self-stretch w-full text-center min-h-[360px] px-[37.5px] gap-[24px]">
        <div className="flex flex-col w-full">
          <div className="mt-1 text-lg leading-[25px] text-foreground">Write it down and keep it safe.</div>
        </div>
        <div className="flex gap-4 self-center text-base leading-9 whitespace-nowrap min-h-[292px] text-foreground">
          <SeedColumn words={leftColumnWords} />
          <SeedColumn words={rightColumnWords} />
        </div>
      </div>
      <div className="w-full flex justify-center">
        <button
          className="relative text-xs font-bold leading-5 text-primary-yellow whitespace-nowrap rounded-2xl flex gap-1"
          tabIndex={0}
          onClick={handleCopyToClipboard}>
          <span>Copy</span>
          <img src={chrome.runtime.getURL('popup/copy_yellow_icon.svg')} alt="Copy" />
          {copied && (
            <div className="absolute ml-1 mt-[-2px] top-0 left-full p-1 bg-body font-normal bg-neutral-700 text-foreground text-xs rounded z-[1]">
              Copied!
            </div>
          )}
        </button>
      </div>
      <div className="left-4 right-4 mt-4 bottom-[19px] flex flex-col gap-3">
        {!isBackedUp && (
          <Button className="w-full" onClick={() => navigate('/onboard/verify-seed')}>
            Verify Seed
          </Button>
        )}
        <Button className="w-full" tabIndex={0} onClick={() => navigate('/dashboard')}>
          Hide
        </Button>
      </div>
    </div>
  );
};

export default RevealSeed;
