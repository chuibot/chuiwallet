import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WordColumn } from '../components/WordColumn';
import { Button } from '@src/components/Button';
import { useWalletContext } from '../context/WalletContext';
import { pickRandomPositions } from '@src/utils';
import { sendMessage } from '@src/utils/bridge';
import Header from '@src/components/Header';

export const VerifySeed: React.FC = () => {
  const navigate = useNavigate();
  const { setIsBackedUp } = useWalletContext();
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(''));
  const [missingPositions, setMissingPositions] = useState<number[]>([]);
  const [userInputs, setUserInputs] = useState<{ [pos: number]: string }>({});
  const [errorMsg, setErrorMsg] = React.useState('');
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    (async () => {
      const positions = pickRandomPositions(3, 12);
      setMissingPositions(positions);

      try {
        const seed: string = await sendMessage('wallet.getMnemonic');
        if (!seed) {
          console.error('Failed to recover seed');
          return;
        }

        setSeedWords(seed.split(' '));
      } catch (err) {
        console.error('Error recovering seed in verify:', err);
      }
    })();
  }, []);

  useEffect(() => {
    const allMissingMatch = missingPositions.every(pos => {
      return userInputs[pos]?.trim() === seedWords[pos - 1]?.trim();
    });
    setIsValid(allMissingMatch);
  }, [userInputs, missingPositions, seedWords]);

  const handleChange = (pos: number, value: string) => {
    const firstWord = value.trim().split(/\s+/)[0];
    setUserInputs(prev => ({ ...prev, [pos]: firstWord }));
  };

  const handleVerify = () => {
    let valid = true;

    for (const pos of missingPositions) {
      const actual = seedWords[pos - 1]?.trim();
      const userVal = userInputs[pos]?.trim();
      if (actual !== userVal) {
        valid = false;
        break;
      }
    }

    if (!valid) {
      setErrorMsg('Seed verification failed. Please try again.');
      return;
    }

    //Todo: Create wallet
    // const mnemonic = seedWords.join(' ').trim();
    // createWallet(mnemonic, password, 'mainnet', 'bech32');

    setIsBackedUp(true);
    navigate('/dashboard');
  };

  const leftWords = seedWords.slice(0, 6).map((word, i) => {
    const pos = i + 1;
    if (missingPositions.includes(pos)) {
      return {
        text: userInputs[pos] || '',
        isInput: true,
        onChange: (val: string) => handleChange(i + 1, val),
        placeholder: `${i + 1}.`,
      };
    }
    return { text: word, isHighlighted: false, isInput: false };
  });
  const rightWords = seedWords.slice(6, 12).map((word, i) => {
    const pos = i + 7;
    if (missingPositions.includes(pos)) {
      return {
        text: userInputs[pos] || '',
        isInput: true,
        onChange: (val: string) => handleChange(i + 7, val),
        placeholder: `${i + 7}.`,
      };
    }
    return { text: word, isHighlighted: false, isInput: false };
  });

  return (
    <div className="relative flex overflow-hidden flex-col px-5 pt-12 pb-[19px] bg-dark h-full w-full">
      <Header title="Verify words" hideClose={true} />
      <div className="flex flex-col self-center w-full text-center">
        <div className="flex flex-col w-full">
          <div className="mt-8 text-lg leading-6 text-foreground">
            Rewrite the correct words on the empty fields to verify your wallet
          </div>
        </div>

        <div className="flex gap-4 self-center mt-6 text-base leading-9 whitespace-nowrap min-h-[289px] text-foreground">
          <WordColumn words={leftWords} />
          <WordColumn words={rightWords} />
        </div>
      </div>

      <span className="mt-6 text-xs text-primary-red font-light text-center">{errorMsg}</span>

      <Button className="absolute w-full bottom-[19px]" disabled={!isValid} onClick={handleVerify}>
        Continue
      </Button>
    </div>
  );
};
