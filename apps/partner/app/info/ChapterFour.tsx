import Image from 'next/image'
import { motion, Variants } from 'framer-motion'

import { 
  chapterVariants

 } from './animations';

import checkInBeach from './check-in-beach.png'
import checkInVenue from './check-in-venue.png'
import checkInAdvance from './check-in-advance.png'
import paymentCapture from './payment-capture.gif'

export const chapter2Part1Variants: Variants = {
  frame0: { height: 0, width: 0, opacity: 0, top: 0 },
  frame1: {
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0, ease: 'easeOut' },
  },
  frame2: {
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
  frame3: {
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
  frame4: {
    top: '-230px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
  frame5: {
    top: '-230px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
};

export const chapter2Part2Variants: Variants = {
  frame0: { height: '100%', width: '100%', opacity: 0, top: '230px' },
  frame1: {
    top: '230px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0, ease: 'easeOut' },
  },
  frame2: {
    top: '230px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
  frame3: {
    top: '230px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
  frame4: {
    top: '0px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
  frame5: {
    top: '0px',
    height: '100%',
    width: '100%',
    opacity: 1,
    transition: { duration: 0.6, ease: 'easeOut' },
  }
};

export const chapter2Frames: { [elem: string]: Variants } = {
    'Title1': {
      frame0: { opacity: 0, fontSize: '18px', scale: 0 },
      frame1: {
        fontSize: '18px',
        opacity: 1,
        scale: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame2: {
        fontSize: '18px',
        opacity: 1,
        scale: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame3: {
        fontSize: '18px',
        opacity: 1,
        scale: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame4: {
        fontSize: '18px',
        opacity: 1,
        scale: 1,
        transition: { duration: 1, ease: 'easeOut' },
      }
    },
    'FlexiblePricingContainer': {
      frame0: { left: '0px' },
      frame1: { left: '0px' },
      frame2: { left: '0px' },
      frame3: {
        left: '-320px',
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame4: {
        left: '-320px',
        transition: { duration: 1, ease: 'easeOut' },
      },
    },
    'FlexiblePricingImage': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: {
        width: '120px',
        height: '81px',
        opacity: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame2: {
        width: '120px',
        height: '81px',
        opacity: 1
      },
      frame3: {
        width: '120px',
        height: '81px',
        opacity: 1
      },
      frame4: {
        width: '120px',
        height: '81px',
        opacity: 1
      }
    },
    'FlexiblePricingTitle': {
      frame0: { height: 0, width: 'auto', opacity: 0 },
      frame1: {
        width: 'auto',
        height: '18px',
        opacity: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame2: {
        width: 'auto',
        height: '18px',
        opacity: 1
      },
      frame3: {
        width: 'auto',
        height: '18px',
        opacity: 1
      },
      frame4: {
        width: 'auto',
        height: '18px',
        opacity: 1
      }
    },
    'FlexiblePricingSubtitle': {
      frame0: { opacity: 0, bottom: '-20px' },
      frame1: { opacity: 0, bottom: '-20px' },
      frame2: {
        bottom: '42px',
        opacity: 1,
        transition: { duration: 0.6, ease: 'easeOut' },
      },
      frame3: {
        bottom: '42px',
        opacity: 1
      },
      frame4: {
        bottom: '42px',
        opacity: 1
      }
    },
    'DynamicPricingContainer': {
      frame0: { left: 'calc(100% + 20px)' },
      frame1: { left: 'calc(100% + 20px)' },
      frame2: { left: 'calc(100% + 20px)' },
      frame3: {
        left: '0px',
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame4: {
        left: '0px',
        transition: { duration: 1, ease: 'easeOut' },
      }
      
    },
    'CheckIn1': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: {
        width: 'auto',
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame2: { height: 0, width: 0, opacity: 0 },
      frame3: { height: 0, width: 0, opacity: 0 }
    },
    'CheckIn2': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: { height: 0, width: 0, opacity: 0 },
      frame2: {
        width: 'auto',
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame3: { height: 0, width: 0, opacity: 0 }
    },
    'CheckIn3': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: { height: 0, width: 0, opacity: 0 },
      frame2: { height: 0, width: 0, opacity: 0 },
      frame3: {
        width: 'auto',
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame4: {
        width: 'auto',
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
    },
    'CheckInImage1': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: {
        width: '160px',
        height: '108px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame2: { height: 0, width: 0, opacity: 0 },
      frame3: { height: 0, width: 0, opacity: 0 }
    },
    'CheckInImage2': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: { height: 0, width: 0, opacity: 0 },
      frame2: {
        width: '160px',
        height: '108px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame3: { height: 0, width: 0, opacity: 0 }
    },
    'CheckInImage3': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: { height: 0, width: 0, opacity: 0 },
      frame2: { height: 0, width: 0, opacity: 0 },
      frame3: {
        width: '160px',
        height: '108px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame4: {
        width: '160px',
        height: '108px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
    }
}

export default function ChapterTwo({
  state
}: {
  state: string
}) {
  
  return (

    <div className="h-[200px] w-full relative">
      <motion.div className="w-full h-auto absolute pt-[16px]"
        variants={chapter2Part1Variants}
        initial="frame0"
        animate={state}>
        In-app product sales
      </motion.div>
      <motion.div className="w-full h-auto absolute"
        variants={chapter2Part2Variants}
        initial="frame0"
        animate={state}>
        <div className="w-full flex">
          Drinks, food, rentals
        </div>
        <div>
          In-app payment
        </div>
      </motion.div>
    </div>

  )

}