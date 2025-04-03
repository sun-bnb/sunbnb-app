'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import logo from './logo.svg';

import { 
  logoVariants,
  sloganVariants,
  chapterVariants,
  chaptersContainerVariants,
  chaptersListVariants,
  chapterItemVariants,
  chapterContentVariants
 } from './animations';
import { useIntroAnimations } from './useIntroAnimations';
import { useState } from 'react';

const chaptersData = [
  {
    title: 'Cut labour costs',
    background: <div className="w-full mt-[80px]">
      <video
        src="/video-1.mp4"
        width={200}
        controls={false}
        autoPlay
      />
    </div>,
    content:
      <div className="w-full">
        <div className="w-full flex ml-[4px]">
          <div className="opacity-50">
            <video
              src="/video-1.mp4"
              width={400}
              controls={false}
              autoPlay
              muted
            />
          </div>
          <div>
            Self-service check-in, in-app payment and automated check-out reduce the need for staff.
          </div>
        </div>
      </div>
  },
  {
    title: 'Increase rental revenue',
    content: 'Maximize occupancy and easily manage dynamic pricing...',
  },
  {
    title: 'Improve customer satisfaction',
    content: 'Provide fast service and smooth online booking experiences...',
  },
  {
    title: 'Sell more products',
    content: 'Add upsells and promotions in your app seamlessly...',
  },
  {
    title: 'Automate accounting',
    content: 'Integrate finance tools with live transaction data...',
  },
];

export default function InfoPage() {
  
  const { logoState, sloganState, chaptersState } = useIntroAnimations();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // If any chapter is selected, we consider container "open" (slides up).
  const containerState = selectedIndex !== null ? 'open' : 'closed';

  function toggleChapter(idx: number) {
    setSelectedIndex((current) => (current === idx ? null : idx));
  }

  const selectedBackground = selectedIndex !== null ? chaptersData[selectedIndex]!.background : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#fff5e1]">
      <div className="absolute top-0 left-0 w-full h-full opacity-50">
      </div>
    <div className="relative min-h-screen overflow-hidden">
      {/* LOGO */}
      <motion.div
        className="absolute top-0 left-0"
        variants={logoVariants}
        initial="hidden"
        animate={logoState}
      >
        <Image src={logo} alt="Sunbnb" width={200} height={200} />
      </motion.div>

      {/* SLOGAN */}
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

      {/* CHAPTER TITLES */}
      <div className="container mx-auto">
        <motion.div
          // pinned at absolute bottom-left
          className="absolute bottom-[20px] left-[0px] max-w-md"
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
                  className="mb-2 pb-2 cursor-pointer"
                >
                  {/* Title row */}
                  <div
                    className="font-semibold text-lg pl-[20px]"
                    onClick={() => toggleChapter(idx)}
                  >
                    {chap.title}
                  </div>

                  {/* Expanded content */}
                  <motion.div
                    variants={chapterContentVariants}
                    initial="collapsed"
                    animate={isOpen ? 'expanded' : 'collapsed'}
                    className="overflow-hidden text-sm text-gray-700"
                  >
                    <div className="mt-2">{chap.content}</div>
                  </motion.div>
                </motion.li>
              );
            })}
          </motion.ul>
        </motion.div>
      </div>
    </div>
    </div>
  );

}