'use client';

import { motion } from 'framer-motion'
import Image from 'next/image'
import logo from './logo.svg'

import { 
  logoVariants,
  sloganVariants,
  chapterVariants,
  chaptersContainerVariants,
  chapterContainerVariants,
  chapterContentVariants,

 } from './animations';
import { useIntroAnimations } from './useIntroAnimations'
import { useState } from 'react'
import ChapterOne from './ChapterOne'
import ChapterTwo from './ChapterTwo'
import ChapterThree from './ChapterThree'
import ChapterFour from './ChapterFour'

export default function InfoPage() {
  
  const { 
    logoState, sloganState, chaptersState,
    chapter1State,
    chapter2State,
    animateChaper1,
    animateChaper2
  } = useIntroAnimations();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // If any chapter is selected, we consider container "open" (slides up).
  const containerState = selectedIndex !== null ? 'open' : 'closed';

  function toggleChapter(idx: number) {
    if (selectedIndex !== idx) {
      if (idx === 0) animateChaper1();
      else if (idx === 1) animateChaper2();
    }
    setSelectedIndex((current) => (current === idx ? null : idx));
  }

  const chaptersData = [
    {
      title: 'Cut labour costs',
      background: <div className="w-full mt-[80px]"></div>,
      content: <ChapterOne state={chapter1State} />
      
    },
    {
      title: 'Increase rental revenue',
      content: <ChapterTwo state={chapter2State} />,
    },
    {
      title: 'Improve customer satisfaction',
      content: selectedIndex === 2 ? <ChapterThree /> : null,
    },
    {
      title: 'Sell more products',
      content: selectedIndex === 3 ? <ChapterFour /> : null
    },
    {
      title: 'Automate accounting',
      content: 'Integrate finance tools with live transaction data...',
    },
  ]

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-[#fff5e1]">
      <motion.div
        className="absolute top-0 left-0"
        variants={logoVariants}
        initial="hidden"
        animate={logoState}
      >
        <Image src={logo} alt="Sunbnb" width={200} height={200} />
      </motion.div>

      <motion.div
        className="absolute top-0 left-0"
        variants={sloganVariants}
        initial="hidden"
        animate={sloganState}
      >
        <div className="font-bold text-center">
          Sunbnb - Your partner
          <br />
          in sunbed management
        </div>
      </motion.div>

      <motion.div
        // pinned at absolute bottom-left
        className="absolute bottom-[20px] left-[0px] h-auto w-full"
        variants={chaptersContainerVariants}
        initial="hidden"
        animate={chaptersState}
      >
        {/* motion.ul that staggers children */}
        <motion.ul
          variants={{
            hidden: { opacity: 1 }, // or keep them invisible if you want
            visible: {
              transition: {
                // We can stagger the child animations
                staggerChildren: 0.15,
              },
            },
          }}
          initial="hidden"
          animate={chaptersState}
        >
          {chaptersData.map((chap, idx) => {
            const isOpen = selectedIndex === idx;

            return (
              <motion.li
                key={idx}
                // Each list item can fade/slide in
                variants={chapterVariants}
                className="ml-[20px] pb-2 cursor-pointer"
              >
                {/* Title row */}
                <div
                  className="font-semibold text-lg"
                  onClick={() => toggleChapter(idx)}
                >
                  {chap.title}
                </div>

                {/* Expanded content */}
                <motion.div
                  variants={chapterContentVariants}
                  initial="collapsed"
                  animate={isOpen ? 'expanded' : 'collapsed'}
                  className="overflow-hidden text-sm text-gray-700 max-w-[400px] mx-auto"
                >
                  <motion.div className="mt-2 relative"
                    variants={chapterContainerVariants}
                    initial="collapsed"
                    animate={isOpen ? 'expanded' : 'collapsed'}>
                      {chap.content}
                  </motion.div>
                </motion.div>
              </motion.li>
            );
          })}
        </motion.ul>
      </motion.div>
    </div>
  );

}