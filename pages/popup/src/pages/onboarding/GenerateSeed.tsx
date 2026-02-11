import type * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@src/components/Button';

export const GenerateSeed: React.FC = () => {
  const navigate = useNavigate();
  const infoLines = ['Back up your wallet.', 'Never lose it.', 'Never share it with anyone.'];

  return (
    <div className="flex h-full w-full overflow-hidden flex-col px-5 pb-[19px] bg-dark">
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
      <div className="flex flex-col justify-between items-center w-full flex-1 pt-32">
        <div className="flex flex-col max-w-[262px]">
          <div className="text-2xl font-extrabold leading-10 text-center text-white">
            We will generate a seed phrase for you
          </div>
          <ul className="mt-6 text-lg leading-6 pl-6 text-foreground list-disc">
            {infoLines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
        <Button className="absolute w-full bottom-[19px]" onClick={() => navigate('/onboard/backup-seed')}>
          Reveal seed phrase
        </Button>
      </div>
    </div>
  );
};
