import Image from 'next/image'
import { motion } from 'framer-motion'

import { 
  chapterVariants,
  chapter1Part1Variants,
  chapter1Frames,
  chapter1Part2Variants

 } from './animations';
 import { useIntroAnimations } from './useIntroAnimations';

import checkInBeach from './check-in-beach.png'
import checkInVenue from './check-in-venue.png'
import checkInAdvance from './check-in-advance.png'
import paymentCapture from './payment-capture.gif'

export default function ChapterOne({
  state
}: {
  state: string
}) {
  
  return (

    <div className="h-[230px] w-full relative">
      <motion.div className="w-full h-auto absolute"
        variants={chapter1Part1Variants}
        initial="frame0"
        animate={state}>
          <div>
            <motion.div className="text-center"
              variants={chapter1Frames['frame0']!['Title1']}
              initial="frame0"
              animate={state}>
              Self-service check-in drastically reduces operation labour.
            </motion.div>
            <div className="w-full relative h-[24px] pt-[10px]">
              <motion.div className="absolute whitespace-nowrap"
                variants={chapter1Frames['frame0']!['SubTitle1']}
                initial="frame0"
                animate={state}>
                <b>Your customers can check in:</b>
              </motion.div>
            </div>
          </div>
          
          <motion.div className="w-full flex ml-[4px] flex h-[300px] justify-center items-center"
            variants={chapter1Frames['frame0']!['CheckInContainer']}
            initial="frame0"
            animate={state}>
            <div className="w-full flex justify-center items-center">
              <div className="w-[60%]">
                <motion.div className="transform rotate-[6deg] border border-[2px] border-black"
                  variants={chapter1Frames['frame0']!['CheckInImage1']}
                  initial="frame0"
                  animate={state}>
                  <Image src={checkInBeach} alt="Self-service check-in" width={220} height={160} />
                </motion.div>
                <motion.div className="transform rotate-[-2deg] border border-[2px] border-black"
                  variants={chapter1Frames['frame0']!['CheckInImage2']}
                  initial="frame0"
                  animate={state}>
                  <Image src={checkInVenue} alt="Self-service check-in" width={220} height={160} />
                </motion.div>
                <motion.div className="transform rotate-[4deg] border border-[2px] border-black"
                  variants={chapter1Frames['frame0']!['CheckInImage3']}
                  initial="frame0"
                  animate={state}>
                  <Image src={checkInAdvance} alt="Self-service check-in" width={220} height={160} />
                </motion.div>
              </div>
              <div className="flex justify-center items-center w-full">
                <motion.div className="whitespace-nowrap text-[16px]"
                  variants={chapter1Frames['frame0']!['CheckIn1']}
                  initial="frame0"
                  animate={state}>
                  <span>ON THE BEACH</span>
                </motion.div>
                <motion.div className="whitespace-nowrap text-[16px]"
                  variants={chapter1Frames['frame0']!['CheckIn2']}
                  initial="frame0"
                  animate={state}>
                  <span>AT THE VENUE</span>
                </motion.div>
                <motion.div className="whitespace-nowrap text-[16px]"
                  variants={chapter1Frames['frame0']!['CheckIn3']}
                  initial="frame0"
                  animate={state}>
                  <span>IN ADVANCE</span>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </motion.div>
        <motion.div className="w-full h-auto absolute"
          variants={chapter1Part2Variants}
          initial="frame0"
          animate={state}>
          <div className="w-full flex">
            <div className="text-center text-[16px] pr-[12px]">
              <div>
                In-app payments eliminate the need for money handling.
              </div>
              <motion.div className="mt-[24px]" 
                  variants={{
                    frame3: { opacity: 0 }, // or keep them invisible if you want
                    frame4: { opacity: 0 }, // or keep them invisible if you want
                    frame5: {
                      opacity: 1,
                      transition: {
                        // We can stagger the child animations
                        staggerChildren: 0.75,
                      }
                    },
                  }}
                  initial="frame3"
                  animate={state}>
                <motion.div
                  key={0}
                  variants={chapterVariants}
                  className="mt-[8px]"
                >
                    <b>Secure mobile payments</b>
                </motion.div>
                <motion.div
                  key={1}
                  variants={chapterVariants}
                  className="mt-[8px]"
                >
                    <b>Regular payouts</b>
                </motion.div>
                <motion.div
                  key={2}
                  variants={chapterVariants}
                  className="mt-[8px]"
                >
                    <b>Automated accounting</b>
                </motion.div>
              </motion.div>
            </div>
            <div>
              <Image src={paymentCapture} alt="Payment" width={200} height={400}/>
            </div>
          </div>
        </motion.div>
        </div>

  )

}