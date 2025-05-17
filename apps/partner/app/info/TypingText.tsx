// TypingText.tsx
import { useEffect, useState } from 'react';

export function TypingText({ text }: { text: string }) {
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleChars(c => (c < text.length ? c + 1 : c));
    }, 50);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <div className="text-xl font-mono flex items-center h-full">
      {text.slice(0, visibleChars)}
      <span className="animate-pulse">|</span>
    </div>
  );
}
