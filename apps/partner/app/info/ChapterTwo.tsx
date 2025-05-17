import Image from 'next/image'
import { motion, Variants } from 'framer-motion'
import StarsIcon from '@mui/icons-material/Stars'
import TodayIcon from '@mui/icons-material/Today'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'

import { 
  chapterVariants

 } from './animations';

import checkInBeach from './check-in-beach.png'
import checkInVenue from './check-in-venue.png'
import checkInAdvance from './check-in-advance.png'
import paymentCapture from './payment-capture.gif'
import sunbedIconTransparent from './sunbed-icon-transparent.png'

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
        left: '-625px',
        transition: { duration: 0.6, ease: 'easeOut' },
      },
      frame4: {
        left: '-625px',
        transition: { duration: 0, ease: 'easeOut' },
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
    'FlexiblePricingStar': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: {
        width: '0px',
        height: '0px',
        opacity: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame2: {
        width: '50px',
        height: '50px',
        opacity: 1,
        transition: { duration: 1, ease: 'easeOut' }
      },
      frame3: {
        width: '50px',
        height: '50px',
        opacity: 1,
        transition: { duration: 1, ease: 'easeOut' }
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
      frame0: { left: 'calc(100% + 30px)' },
      frame1: { left: 'calc(100% + 30px)' },
      frame2: { left: 'calc(100% + 30px)' },
      frame3: {
        left: '0px',
        transition: { duration: 0.6, ease: 'easeOut' },
      },
      frame4: {
        left: '0px',
        transition: { duration: 0, ease: 'easeOut' },
      },
      frame5: {
        left: '0px',
        transition: { duration: 0, ease: 'easeOut' },
      }
    },
    'DynamicPricingImage': {
      frame3: {
        width: '80px',
        height: '80px'
      },
      frame4: {
        width: '80px',
        height: '80px'
      },
      frame5: {
        width: '80px',
        height: '80px'
      }
    },
    'DynamicPricingTitle': {
      frame2: { width: 'auto', opacity: 0, top: '-80px' },
      frame3: { width: 'auto', opacity: 0, top: '-80px'  },
      frame4: {
        width: 'auto',
        height: '18px',
        opacity: 1,
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame5: {
        width: 'auto',
        height: '18px',
        opacity: 1
      }
    },
    'DynamicPricingSubtitle': {
      frame2: { opacity: 0, bottom: '-20px' },
      frame3: {
        bottom: '60px',
        opacity: 1,
        transition: { duration: 0.6, ease: 'easeOut' },
      },
      frame4: {
        bottom: '60px',
        opacity: 1
      },
      frame5: {
        bottom: '60px',
        opacity: 1
      }
    },
    'SalesChannelsContainer': {
      frame0: { left: 'calc(100% + 30px)' },
      frame1: { left: 'calc(100% + 30px)' },
      frame2: { left: 'calc(100% + 30px)' },
      frame3: {
        left: '0px',
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame4: {
        left: '0px',
        transition: { duration: 0, ease: 'easeOut' },
      },
      frame5: {
        left: '0px',
        transition: { duration: 0, ease: 'easeOut' },
      }
    },
    'SalesChannelsTitle': {
      frame2: { width: 'auto', top: '-80px' },
      frame3: { width: 'auto', top: '-80px'  },
      frame4: {
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame5: {
        height: '18px'
      }
    },
    'SalesChannelsImage': {
      frame2: { opacity: 0, bottom: '-20px' },
      frame3: {
        bottom: '0px',
        opacity: 1,
        transition: { duration: 0.6, ease: 'easeOut' },
      },
      frame4: {
        width: '80px',
        height: '80px',
        opacity: 1
      },
      frame5: {
        width: '80px',
        height: '80px',
        opacity: 1
      }
    },
    'SalesChannelsText': {
      frame2: { opacity: 0, bottom: '-20px' },
      frame3: {
        bottom: '42px',
        opacity: 1,
        transition: { duration: 0.6, ease: 'easeOut' },
      },
      frame4: {
        bottom: '42px',
        opacity: 1
      },
      frame5: {
        bottom: '42px',
        opacity: 1
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
        <div>
          <motion.div className="text-center"
            variants={chapter2Frames['Title1']}
            initial="frame0"
            animate={state}>
            Bring in more revenue with Sunbnb's pricing features
          </motion.div>
        </div>
        <motion.div className="w-full h-auto flex justify-center items-center absolute"
          variants={chapter2Frames['FlexiblePricingContainer']}
          initial="frame0"
          animate={state}>
          <div className="w-full flex h-[160px] items-center">
            <div className="w-[40%] flex justify-center items-center relative">
              <motion.div className=""
                variants={chapter2Frames['FlexiblePricingImage']}
                initial="frame0"
                animate={state}>
                <Image src={sunbedIconTransparent} alt="Self-service check-in" width={220} height={160} />
              </motion.div>
              <motion.div className="absolute top-0 right-0"
                variants={chapter2Frames['FlexiblePricingStar']}
                initial="frame0"
                animate={state}>
                <StarsIcon style={{ width: '100%', height: '100%' }}/>
              </motion.div>
            </div>
            <div className="w-[60%] relative h-full">
              <motion.div className="w-full text-center whitespace-nowrap text-[16px] mb-[8px] mt-[42px]"
                variants={chapter2Frames['FlexiblePricingTitle']}
                initial="frame0"
                animate={state}>
                <b>FLEXIBLE PRICING</b>
              </motion.div>
              <motion.div className="w-full text-center text-[16px] absolute"
                variants={chapter2Frames['FlexiblePricingSubtitle']}
                initial="frame0"
                animate={state}>
                <span>Rent premium seats at a premium price</span>
              </motion.div>
            </div>
          </div>
        </motion.div>
        <motion.div className="w-full h-auto flex justify-center items-center absolute"
          variants={chapter2Frames['DynamicPricingContainer']}
          initial="frame0"
          animate={state}>
          <div className="w-full flex h-[160px] items-center">
            <div className="w-[30%] flex-justify-center items-center">
              <motion.div className=""
                variants={chapter2Frames['DynamicPricingImage']}
                initial="frame0"
                animate={state}>
                <TrendingUpIcon style={{ width: '100%', height: '100%' }} />
              </motion.div>
            </div>
            <div className="w-[70%] relative h-full">
              <motion.div className="w-full text-center whitespace-nowrap text-[16px] absolute"
                variants={chapter2Frames['DynamicPricingTitle']}
                initial="frame0"
                animate={state}>
                <b>DYNAMIC PRICING</b>
              </motion.div>
              <motion.div className="w-full text-center text-[16px] absolute"
                variants={chapter2Frames['DynamicPricingSubtitle']}
                initial="frame0"
                animate={state}>
                <span>Get the maximum price based on seasonal demand</span>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
      <motion.div className="w-full h-auto absolute"
        variants={chapter2Part2Variants}
        initial="frame0"
        animate={state}>
        <div className="w-full flex justify-center text-[16px] mt-[12px]"><b>MAXIMIZE OFF-SEASON OCCUPANCY</b></div>
        <motion.div className="w-full h-auto flex justify-center items-center absolute"
          variants={chapter2Frames['SalesChannelsContainer']}
          initial="frame0"
          animate={state}>
          <div className="w-full flex h-[160px] items-center">
            <div className="w-[30%]">
              <motion.div className=""
                variants={chapter2Frames['SalesChannelsImage']}
                initial="frame0"
                animate={state}>
                <TodayIcon style={{ width: '100%', height: '100%' }} />
              </motion.div>
            </div>
            <div className="w-[70%] relative h-full">
              <motion.div className="w-full text-center text-[16px] absolute"
                variants={chapter2Frames['SalesChannelsText']}
                initial="frame0"
                animate={state}>
                1. Reservation calendar and demand forecast
                <br/><br/>
                2. New marketing channels: Online, Hotels
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>

  )

}