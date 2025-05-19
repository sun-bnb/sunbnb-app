import { motion, Variants } from 'framer-motion';
import { ReactNode } from 'react';

const animations: {
  [key: string]: Variants
} = {
  none: {
    initial: { opacity: 1 },
    animate: { opacity: 1 },
    exit: { opacity: 1 },
  },
  fadeInOut: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 2, delay: 1 } },
    exit: { opacity: 0, transition: { duration: 1 } },
  },
  verticalFlip: {
    initial: {
      rotateX: 90,
      opacity: 0,
      transformPerspective: 600,
    },
    animate: {
      rotateX: 0,
      opacity: 1,
      transition: { duration: 1, delay: 1, ease: 'easeOut' }
    },
    exit: {
      rotateX: -90,
      opacity: 0,
      transition: { duration: 1, ease: 'easeIn' }
    }
  },
  horizontalFlip: {
    initial: {
      rotateY: 90,
      opacity: 0,
      transformPerspective: 600, // Important for 3D effect
    },
    animate: {
      rotateY: 0,
      opacity: 1,
      transition: { duration: 1, delay: 1, ease: 'easeOut' }
    },
    exit: {
      rotateY: -90,
      opacity: 0,
      transition: { duration: 0.4, ease: 'easeIn' }
    }
  },
  slideToRight: {
    initial: { opacity: 1, x: -100 },
    animate: { opacity: 1, x: 0, transition: { duration: 2 } },
    exit: { opacity: 1, x: 0, transition: { duration: 1 } },
  },
  slideToLeft: {
    initial: { opacity: 1, x: 300 },
    animate: { opacity: 1, x: 0, transition: { duration: 1 } },
    exit: { opacity: 1, x: 0, transition: { duration: 1 } },
  }
}

const textVariants: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay: 0.2 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};

const headerVariants: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 1, delay: 0.5 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};

type Props = {
  layout: 'horizontal' | 'vertical';
  illustration: ReactNode;
  header?: ReactNode;
  content: ReactNode;
  animation: keyof typeof animations;
  imageSize: number;
  imageFirst?: boolean;
};

export function MultimediaFrame({ layout, header, illustration, content, animation, imageSize, imageFirst = true }: Props) {
  return (
    <div className="w-full h-[200px] px-4 items-center justify-between gap-4">
      {
        header &&
          <motion.div variants={headerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full mt-[8px] -mb-[20px]">
            { header }
          </motion.div>
      }
      <div style={{
        flexDirection: layout === 'horizontal' ? 'row' : 'column'
      }} className={`flex w-full h-full items-center justify-between gap-4`}>
        {imageFirst && (
          <motion.div
            variants={animations[animation]}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`flex justify-center items-center`}
            style={layout === 'horizontal' ? { width: `${imageSize}%` } : { height: `${imageSize}%` } }
          >
            {illustration}
          </motion.div>
        )}

        <motion.div
          style={layout === 'horizontal' ? { width: `${100 - imageSize}%` } : { height: `${100 - imageSize}%` } }
          variants={textVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {content}
        </motion.div>

        {!imageFirst && (
          <motion.div
            className={`h-full flex items-center justify-center`}
            style={layout === 'horizontal' ? { width: `${imageSize}%` } : { height: `${imageSize}%` } }
            variants={animations[animation]}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {illustration}
          </motion.div>
        )}
      </div>
    </div>
  );
}
