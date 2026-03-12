import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@src/components/Button';
import { useWalletContext } from '@src/context/WalletContext';
import { pickRandomPositions } from '@src/utils';
import { sendMessage } from '@src/utils/bridge';
import Header from '@src/components/Header';

interface Challenge {
  position: number; // 1-based
  answer: string;
  choices: string[]; // 4 shuffled options
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export const VerifySeed: React.FC = () => {
  const navigate = useNavigate();
  const { setIsBackedUp } = useWalletContext();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>(['', '', '']);
  const [verified, setVerified] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const seed: string = await sendMessage('wallet.getMnemonic');
        if (!seed) return;
        const words = seed.split(' ');
        const positions = pickRandomPositions(3, 12);
        setChallenges(
          positions.map(pos => {
            const answer = words[pos - 1];
            const decoys = words
              .filter((_, i) => i !== pos - 1)
              .sort(() => Math.random() - 0.5)
              .slice(0, 3);
            return { position: pos, answer, choices: shuffle([answer, ...decoys]) };
          }),
        );
      } catch (err) {
        console.error('Error recovering seed in verify:', err);
      }
    })();
  }, []);

  if (!challenges.length) return null;

  const current = challenges[step];
  const isLastStep = step === challenges.length - 1;

  const handleSelect = (word: string) => {
    const next = [...picked];
    next[step] = word;
    setPicked(next);
    setFailed(false);
  };

  const handleNext = () => {
    if (!isLastStep) {
      setStep(s => s + 1);
      return;
    }
    const allCorrect = challenges.every((c, i) => picked[i] === c.answer);
    if (allCorrect) {
      setVerified(true);
    } else {
      setFailed(true);
      setStep(0);
      setPicked(['', '', '']);
    }
  };

  const handleContinue = async () => {
    await sendMessage('wallet.setBackupStatus', { isBackedUp: true });
    setIsBackedUp(true);
    navigate('/dashboard');
  };

  return (
    <div className="relative flex overflow-hidden flex-col px-5 pt-12 pb-[19px] bg-dark h-full w-full">
      <Header title="Verify words" hideClose={true} />

      <div className="flex flex-col items-center w-full mt-8 flex-grow">
        <p className="text-lg leading-6 text-foreground text-center">
          Select the correct word for each position to verify your backup
        </p>

        {/* Step indicator */}
        <div className="flex gap-3 mt-6">
          {challenges.map((_, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                verified || i < step ? 'bg-primary-yellow' : i === step ? 'bg-foreground' : 'bg-gray-600'
              }`}
            />
          ))}
        </div>

        {!verified ? (
          <>
            <p className="mt-10 text-sm text-foreground/60">What is word #{current.position}?</p>

            <div className="grid grid-cols-2 gap-3 mt-4 w-full">
              {current.choices.map(word => (
                <button
                  key={word}
                  onClick={() => handleSelect(word)}
                  className={`py-3 rounded-lg text-sm font-semibold transition-colors ${picked[step] === word ? 'bg-primary-yellow text-dark' : 'bg-neutral-700 text-foreground hover:bg-neutral-600'}`}>
                  {word}
                </button>
              ))}
            </div>

            {failed && (
              <p className="mt-4 text-xs text-primary-red text-center">One or more words were incorrect. Try again.</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center mt-16">
            <span className="text-5xl text-primary-yellow font-bold">&#10003;</span>
            <p className="text-foreground text-center mt-4 text-lg">Seed phrase verified!</p>
          </div>
        )}
      </div>

      {!verified ? (
        <Button className="absolute w-full bottom-[19px]" disabled={picked[step] === ''} onClick={handleNext}>
          {isLastStep ? 'Verify' : 'Next'}
        </Button>
      ) : (
        <Button className="absolute w-full bottom-[19px]" onClick={handleContinue}>
          Continue
        </Button>
      )}
    </div>
  );
};
