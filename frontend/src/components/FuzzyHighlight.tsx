import React from 'react';

interface FuzzyHighlightProps {
  text: string;
  query: string;
}

export const FuzzyHighlight: React.FC<FuzzyHighlightProps> = ({ text, query }) => {
  if (!query) return <span>{text}</span>;

  const chars = text.split('');
  const queryChars = query.toLowerCase().split('');
  let queryIdx = 0;

  return (
    <span>
      {chars.map((char, i) => {
        if (queryIdx < queryChars.length && char.toLowerCase() === queryChars[queryIdx]) {
          queryIdx++;
          return (
            <span key={i} className="text-emerald-400 font-bold underline decoration-emerald-500/50">
              {char}
            </span>
          );
        }
        return <span key={i}>{char}</span>;
      })}
    </span>
  );
};
