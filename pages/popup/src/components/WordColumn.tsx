import type * as React from 'react';

export interface WordItemProps {
  text: string;
  isHighlighted?: boolean;
  isInput?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
}

export interface WordColumnProps {
  words: WordItemProps[];
}

export const WordColumn: React.FC<WordColumnProps> = ({ words }) => (
  <div className="flex flex-col justify-between w-[134px]">
    {words.map((item, index) => (
      <div key={index} className={index > 0 ? 'mt-3.5' : ''}>
        <div className="flex flex-col w-full max-w-[131px]">
          {item.isInput ? (
            <input
              type="text"
              value={item.text}
              placeholder={item.placeholder || ''}
              onChange={e => item.onChange && item.onChange(e.target.value)}
              className="gap-3 self-stretch px-1.5 w-full rounded-md min-h-[35px] bg-neutral-400 text-neutral-800 text-center placeholder-[#222222]"
            />
          ) : (
            <div
              className={`gap-3 self-stretch px-1.5 w-full rounded-md min-h-[35px] cursor-default ${
                item.isHighlighted ? 'bg-neutral-400 text-neutral-800' : 'bg-neutral-700 text-foreground'
              }`}>
              {item.text}
            </div>
          )}
        </div>
      </div>
    ))}
  </div>
);
