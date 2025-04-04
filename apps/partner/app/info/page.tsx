'use client';

import { motion } from 'framer-motion'
import Image from 'next/image'
import logo from './logo.svg'
import checkInBeach from './check-in-beach.png'
import checkInVenue from './check-in-venue.png'
import checkInAdvance from './check-in-advance.png'

import { 
  logoVariants,
  sloganVariants,
  chapterVariants,
  chaptersContainerVariants,
  chaptersListVariants,
  chapterItemVariants,
  chapterContentVariants,
  chapter1Variants,
  chapter1Frames

 } from './animations';
import { useIntroAnimations } from './useIntroAnimations';
import { useState } from 'react';

export default function InfoPage() {
  
  const { 
    logoState, sloganState, chaptersState,
    chapter1State,
    animateChaper1
  } = useIntroAnimations();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // If any chapter is selected, we consider container "open" (slides up).
  const containerState = selectedIndex !== null ? 'open' : 'closed';

  function toggleChapter(idx: number) {
    if (selectedIndex !== idx) {
      if (idx === 0) animateChaper1();
    }
    setSelectedIndex((current) => (current === idx ? null : idx));
  }

  const chaptersData = [
    {
      title: 'Cut labour costs',
      background: <div className="w-full mt-[80px]">
      </div>,
      content:
      <motion.div className="w-full"
        variants={chapter1Variants}
        initial="frame0"
        animate={chapter1State}>
          <div>
            <motion.div className="text-center"
              variants={chapter1Frames['frame0']!['Title1']}
              initial="frame0"
              animate={chapter1State}>
              Self-service check-in drastically reduces operation labour.
            </motion.div>
            <div className="w-full relative h-[24px] pt-[10px]">
              <motion.div className="absolute whitespace-nowrap"
                variants={chapter1Frames['frame0']!['SubTitle1']}
                initial="frame0"
                animate={chapter1State}>
                <b>Your customers can check in:</b>
              </motion.div>
            </div>
          </div>
          
          <motion.div className="w-full flex ml-[4px] flex h-[300px] justify-center items-center"
            variants={chapter1Frames['frame0']!['CheckInContainer']}
            initial="frame0"
            animate={chapter1State}>
            <div className="w-full flex justify-center items-center">
              <div className="w-[60%]">
                <motion.div className="transform rotate-[6deg] border border-[2px] border-black"
                  variants={chapter1Frames['frame0']!['CheckInImage1']}
                  initial="frame0"
                  animate={chapter1State}>
                  <Image src={checkInBeach} alt="Self-service check-in" width={220} height={160} />
                </motion.div>
                <motion.div className="transform rotate-[-2deg] border border-[2px] border-black"
                  variants={chapter1Frames['frame0']!['CheckInImage2']}
                  initial="frame0"
                  animate={chapter1State}>
                  <Image src={checkInVenue} alt="Self-service check-in" width={220} height={160} />
                </motion.div>
                <motion.div className="transform rotate-[4deg] border border-[2px] border-black"
                  variants={chapter1Frames['frame0']!['CheckInImage3']}
                  initial="frame0"
                  animate={chapter1State}>
                  <Image src={checkInAdvance} alt="Self-service check-in" width={220} height={160} />
                </motion.div>
              </div>
              <div className="flex justify-center items-center w-full">
                <motion.div className="whitespace-nowrap text-[16px]"
                  variants={chapter1Frames['frame0']!['CheckIn1']}
                  initial="frame0"
                  animate={chapter1State}>
                  <span>ON THE BEACH</span>
                </motion.div>
                <motion.div className="whitespace-nowrap text-[16px]"
                  variants={chapter1Frames['frame0']!['CheckIn2']}
                  initial="frame0"
                  animate={chapter1State}>
                  <span>AT THE VENUE</span>
                </motion.div>
                <motion.div className="whitespace-nowrap text-[16px]"
                  variants={chapter1Frames['frame0']!['CheckIn3']}
                  initial="frame0"
                  animate={chapter1State}>
                  <span>IN ADVANCE</span>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </motion.div>
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
  ]

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#fff5e1]">
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
  );

}