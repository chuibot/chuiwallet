import bip39 from 'bip39';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WordColumn } from '../components/WordColumn';
import { Button } from '@src/components/Button';
import { sendMessage } from '@src/utils/bridge';
import { getSessionPassword } from '@extension/backend/src/utils/sessionStorageHelper';
import { useWalletContext } from '@src/context/WalletContext';

export const RestoreSeed: React.FC = () => {
  const navigate = useNavigate();
  const { setIsBackedUp } = useWalletContext();
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(''));
  const [errorMsg, setErrorMsg] = React.useState('');
  const [isValid, setIsValid] = useState(false);

  const wordValidity = useMemo(() => {
    return seedWords.map(word => {
      const trimmed = word.trim().toLowerCase();
      return trimmed !== '' && bip39.wordlists.english.includes(trimmed);
    });
  }, [seedWords]);

  useEffect(() => {
    const allWordsValid = wordValidity.every(valid => valid);
    const mnemonic = seedWords.join(' ').trim();
    const mnemonicValid = allWordsValid && bip39.validateMnemonic(mnemonic);
    setIsValid(mnemonicValid);
  }, [seedWords, wordValidity]);

  const handleChange = (pos: number, value: string) => {
    setSeedWords(prev => {
      const updated = [...prev];
      updated[pos - 1] = value.trim();
      return updated;
    });
  };

  const handleContainerPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const pasteData = e.clipboardData.getData('Text').trim();
    const splitWords = pasteData.split(/\s+/);
    if (splitWords.length === 12) {
      e.preventDefault();
      setSeedWords(splitWords);
    }
  };

  const handleRestore = () => {
    (async () => {
      setErrorMsg('');

      if (!isValid) {
        setErrorMsg('Seed phrase is invalid. Please check each word.');
        return;
      }

      for (let i = 0; i < 12; i++) {
        if (!seedWords[i] || seedWords[i].trim() === '') {
          setErrorMsg('Please fill in all 12 words.');
          return;
        }
      }

      const mnemonic = seedWords.join(' ').trim();
      const password = await getSessionPassword();
      if (!password) {
        setErrorMsg('No universal password found. Please unlock your wallet first.');
        return;
      }

      await sendMessage('wallet.create', { mnemonic, password });
      await sendMessage('wallet.setBackupStatus', { isBackedUp: true });

      setIsBackedUp(true);
      navigate('/onboard/complete?restored=1');
    })();
  };

  const leftWords = seedWords.slice(0, 6).map((word, i) => ({
    text: word,
    isInput: true,
    onChange: (val: string) => handleChange(i + 1, val),
    placeholder: `${i + 1}.`,
    isValid: wordValidity[i],
  }));

  const rightWords = seedWords.slice(6, 12).map((word, i) => ({
    text: word,
    isInput: true,
    onChange: (val: string) => handleChange(i + 7, val),
    placeholder: `${i + 7}.`,
    isValid: wordValidity[i + 6],
  }));

  return (
    <div
      className="relative flex overflow-hidden flex-col px-5 px-4pb-[19px] bg-dark h-full w-full"
      onPaste={handleContainerPaste}>
      <div className="flex gap-10 justify-between items-center self-stretch py-3 w-full text-xs font-bold leading-6 bg-dark min-h-[48px] text-neutral-200">
        <button onClick={() => navigate('/onboard/choose-method')} className="flex justify-start items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="size-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
      </div>
      <div className="flex flex-col self-center w-full text-center">
        <div className="flex flex-col w-full">
          <div className="text-2xl font-bold leading-loose text-white">Input your seed phrase</div>
          <div className="mt-3 text-lg leading-6 text-foreground">
            Rewrite the correct words on the empty fields to open your wallet
          </div>
        </div>

        <div className="flex gap-4 self-center mt-6 text-base leading-9 whitespace-nowrap min-h-[289px] text-foreground">
          <WordColumn words={leftWords} />
          <WordColumn words={rightWords} />
        </div>
      </div>

      <span className="mt-6 text-xs text-primary-red font-light text-center">{errorMsg}</span>

      <Button className="absolute w-full bottom-[19px]" disabled={!isValid} onClick={handleRestore}>
        Continue
      </Button>
    </div>
  );
};
