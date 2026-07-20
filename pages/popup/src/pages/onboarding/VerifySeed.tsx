import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@src/components/Button';
import { useWalletContext } from '@src/context/WalletContext';
import { sendMessage } from '@src/utils/bridge';
import Header from '@src/components/Header';

export const VerifySeed = () => {
  const navigate = useNavigate();
  const { setBackupStatus } = useWalletContext();
  const [seed, setSeed] = useState('');
  const [input, setInput] = useState('');
  const [failed, setFailed] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    (async () => {
      const mnemonic: string = await sendMessage('wallet.getMnemonic');
      setSeed(mnemonic);
    })();
  }, []);

  const handleVerify = () => {
    if (input.trim() === seed.trim()) {
      setVerified(true);
    } else {
      setFailed(true);
      setInput('');
    }
  };

  const handleContinue = async () => {
    await setBackupStatus(true);
    navigate('/dashboard');
  };

  return (
    <div className="relative flex overflow-hidden flex-col px-5 pt-12 pb-[19px] bg-dark h-full w-full">
      <Header title="Verify words" hideClose={true} />

      <div className="flex flex-col items-center w-full mt-8 flex-grow">
        {!verified ? (
          <>
            <p className="text-lg leading-6 text-foreground text-center">
              Enter your seed phrase to confirm you've backed it up
            </p>

            <textarea
              className="w-full mt-6 p-3 rounded-lg bg-neutral-700 text-foreground text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary-yellow"
              rows={4}
              placeholder="Enter your 12-word seed phrase..."
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              value={input}
              onChange={e => {
                setInput(e.target.value);
                setFailed(false);
              }}
            />

            {failed && <p className="mt-3 text-xs text-primary-red text-center">Incorrect seed phrase. Try again.</p>}
          </>
        ) : (
          <div className="flex flex-col items-center mt-16">
            <span className="text-5xl text-primary-yellow font-bold">&#10003;</span>
            <p className="text-foreground text-center mt-4 text-lg">Seed phrase verified!</p>
          </div>
        )}
      </div>

      {!verified ? (
        <Button className="absolute w-full bottom-[19px]" disabled={input.trim() === ''} onClick={handleVerify}>
          Verify
        </Button>
      ) : (
        <Button className="absolute w-full bottom-[19px]" onClick={handleContinue}>
          Continue
        </Button>
      )}
    </div>
  );
};
