// useIntroAnimations.ts
import { useState, useEffect } from 'react';

export function useIntroAnimations() {

  const [logoState, setLogoState] = useState<'hidden' | 'center' | 'corner'>('hidden');
  const [sloganState, setSloganState] = useState<'hidden' | 'center' | 'top'>('hidden');
  const [chaptersState, setChaptersState] = useState<'hidden' | 'visible'>('hidden');

  useEffect(() => {
    // Step 1: show logo + slogan in center
    const t1 = setTimeout(() => {
      setLogoState('center');
      setSloganState('center');
    }, 100);

    // Step 2: move them to corner / top
    const t2 = setTimeout(() => {
      setLogoState('corner');
      setSloganState('top');
    }, 2200);

    // Step 3: show chapters
    const t3 = setTimeout(() => {
      setChaptersState('visible');
    }, 3200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return { logoState, sloganState, chaptersState };

}
