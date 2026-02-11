import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@src/components/Button';
import { useWalletContext } from '@src/context/WalletContext';

export function Complete() {
  const navigate = useNavigate();
  const { setOnboarded } = useWalletContext();
  const [searchParams] = useSearchParams();
  const isRestored = searchParams.get('restored') === '1';

  const handleComplete = () => {
    setOnboarded(true);
    navigate('/dashboard');
  };

  return (
    <div className="relative flex overflow-hidden flex-col items-center px-5 pt-24 pb-[19px] bg-dark h-full">
      <div className="flex flex-col flex-1 items-center w-full">
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-1 flex-col self-stretch w-full text-center">
            <div className="text-2xl font-bold leading-loose text-white">
              You've {isRestored ? 'restored' : 'created'} a wallet
            </div>
            <div className="mt-3 text-lg leading-none text-foreground">Keep your seed phrase safe.</div>
          </div>
          <div className="flex justify-center items-center w-full gap-[18px]">
            <img
              loading="lazy"
              src={chrome.runtime.getURL('popup/bch_coin.svg')}
              alt="BCH"
              className="object-contain self-stretch my-auto aspect-square w-[78px]"
            />
            <img
              loading="lazy"
              src={chrome.runtime.getURL('popup/btc_coin.svg')}
              alt="BTC"
              className="object-contain self-stretch my-auto aspect-square w-[78px]"
            />
            <img
              loading="lazy"
              src={chrome.runtime.getURL('popup/usdt_coin.svg')}
              alt="USDT"
              className="object-contain self-stretch my-auto aspect-square w-[78px]"
            />
          </div>
          <div className="text-lg leading-6 text-center text-foreground">
            Remember we can't recover
            <br />
            your seed phrase for you.
          </div>
        </div>
      </div>

      <div className="absolute w-full px-5 bottom-[19px] flex flex-col gap-3">
        {!isRestored && (
          <button
            onClick={() => navigate('/settings/advanced/reveal-seed')}
            className="text-primary-yellow text-lg font-bold py-2 hover:underline">
            Reveal Seed Phrase
          </button>
        )}

        <Button className="relative w-full" onClick={handleComplete}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
