import type * as React from 'react';

export interface SeedColumnProps {
  words: string[];
  startIndex?: number;
}

export const SeedColumn: React.FC<SeedColumnProps> = ({ words, startIndex = 1 }) => (
  <div className="flex flex-col justify-between w-[134px]">
    {words.map((word, index) => (
      <div key={index} className={index > 0 ? 'mt-3.5' : ''}>
        <div className="flex flex-col w-full max-w-[131px]">
          <div className="gap-3 self-stretch px-1.5 w-full rounded-md bg-neutral-700 min-h-[35px]">
            <span className="text-neutral-400">{startIndex + index}.</span> {word}
          </div>
        </div>
      </div>
    ))}
  </div>
);
