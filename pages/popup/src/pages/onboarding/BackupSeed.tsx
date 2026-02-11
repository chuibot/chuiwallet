import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SeedColumn } from '@src/components/SeedColumn';
import { Button } from '@src/components/Button';
import { sendMessage } from '@src/utils/bridge';
import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';

export const BackupSeed: React.FC = () => {
  const navigate = useNavigate();
  const [leftColumnWords, setLeftColumnWords] = useState<string[]>([]);
  const [rightColumnWords, setRightColumnWords] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const password = await getSessionPassword();
        await sendMessage('wallet.create', { password });
        const seed: string = await sendMessage('wallet.getMnemonic');
        if (!seed) {
          console.error('Failed to recover seed');
          return;
        }

        const words = seed.split(' ');
        if (words.length !== 12) {
          console.error('Expected 12 words, got', words.length);
        }

        setLeftColumnWords(words.slice(0, 6));
        setRightColumnWords(words.slice(6, 12));
      } catch (err) {
        console.error('Error recovering seed:', err);
      }
    })();
  }, []);

  const handleCopyToClipboard = async () => {
    try {
      const seed = [...leftColumnWords, ...rightColumnWords].join(' ');
      const words = seed.split(' ');
      if (words.length !== 12) {
        console.error('Expected 12 words, got', words.length);
      }

      await navigator.clipboard.writeText(seed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy seed:', err);
    }
  };

  const handleSkip = async () => {
    navigate('/onboard/complete');
  };

  return (
    <div className="relative flex overflow-hidden flex-col items-center px-5 pt-12 pb-[19px] bg-dark h-full w-full">
      <div className="flex flex-col justify-between self-stretch w-full text-center min-h-[388px]">
        <div className="flex flex-col w-full">
          <div className="text-2xl font-bold leading-loose text-white">Back up your seed phrase</div>
          <div className="mt-1 text-lg leading-none text-foreground">Write it down and keep it safe.</div>
        </div>
        <div className="flex gap-4 self-center mt-6 text-base leading-9 whitespace-nowrap min-h-[292px] text-foreground">
          <SeedColumn words={leftColumnWords} />
          <SeedColumn words={rightColumnWords} />
        </div>
      </div>

      <button
        className="relative mt-4 text-xs font-bold leading-5 text-primary-yellow whitespace-nowrap rounded-2xl flex gap-1"
        tabIndex={0}
        onClick={handleCopyToClipboard}>
        <span>Copy</span>
        <img src={chrome.runtime.getURL('popup/copy_yellow_icon.svg')} className="Copy Seed Phrase" alt="Copy" />
        {copied && (
          <div className="absolute ml-1 mt-[-2px] top-0 left-full p-1 bg-body font-normal bg-neutral-700 text-foreground text-xs rounded z-[1]">
            Copied!
          </div>
        )}
      </button>

      <button
        className="gap-2.5 self-stretch px-2.5 py-3 text-lg font-bold leading-8 text-primary-yellow whitespace-nowrap rounded-2xl"
        tabIndex={0}
        onClick={handleSkip}>
        Skip
      </button>

      <Button className="absolute w-full bottom-[19px]" tabIndex={0} onClick={() => navigate('/onboard/verify-seed')}>
        Verify seed
      </Button>
    </div>
  );
};
