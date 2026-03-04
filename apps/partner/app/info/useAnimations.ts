import { useEffect } from 'react';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function useFrameAnimation(
  setState: (value: string) => void,
  delays: number[],
  initialFrame: number = 0
) {
  useEffect(() => {

    let isCancelled = false;

    (async () => {
      for (let i = 1; i <= delays.length; i++) {
        await sleep(delays[i - 1]!);
        if (isCancelled) break;
        setState(`frame${initialFrame + i}`);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);
}
