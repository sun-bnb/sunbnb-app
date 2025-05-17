// useIntroAnimations.ts
import { useState, useEffect } from 'react';

export function useIntroAnimations() {

  const [logoState, setLogoState] = useState<'hidden' | 'center' | 'corner'>('hidden');
  const [sloganState, setSloganState] = useState<'hidden' | 'center' | 'top'>('hidden');
  const [chaptersState, setChaptersState] = useState<'hidden' | 'visible'>('hidden');

  const [chapter1State, setChapter1State] = useState<'frame0' | 'frame1' | 'frame2' | 'frame3' | 'frame4' | 'frame5'>('frame0');
  const [chapter2State, setChapter2State] = useState<string>('frame0');
  const [chapter3State, setChapter3State] = useState<string>('frame0');

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

  function animateChaper1() {
    setTimeout(() => {
      setChapter1State('frame1');
      setTimeout(() => {
        setChapter1State('frame2');
        setTimeout(() => {
          setChapter1State('frame3');
          setTimeout(() => {
            setChapter1State('frame4');
            setTimeout(() => {
              setChapter1State('frame5');
            }, 1000);
          }, 2500);
        }, 2500);
      }, 2500);
    }, 100);
  }

  function animateChaper2() {
    setTimeout(() => {
      setChapter2State('frame1');
      setTimeout(() => {
        setChapter2State('frame2');
        setTimeout(() => {
          setChapter2State('frame3');
          setTimeout(() => {
            setChapter2State('frame4');
            setTimeout(() => {
              setChapter2State('frame5');
            }, 4000);
          }, 6000);
        }, 2500);
      }, 2500);
    }, 100);
  }

  function animateChaper3() {
    setTimeout(() => {
      setChapter2State('frame1');
      setTimeout(() => {
        setChapter2State('frame2');
        setTimeout(() => {
          setChapter2State('frame3');
          setTimeout(() => {
            setChapter2State('frame4');
            setTimeout(() => {
              setChapter2State('frame5');
            }, 4000);
          }, 6000);
        }, 2500);
      }, 2500);
    }, 100);
  }

  return { 
    logoState, 
    sloganState,
    chaptersState,
    chapter1State,
    chapter2State,
    chapter3State,
    animateChaper1,
    animateChaper2,
    animateChaper3
  }

}
