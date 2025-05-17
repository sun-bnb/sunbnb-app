// Slide container with shared frame transitions
import { AnimatePresence, motion, Variants } from 'framer-motion';

const slideVariants: Variants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { duration: 0.6 } },
  exit: { x: '-100%', opacity: 0, transition: { duration: 0.6 } },
};

export function FrameWrapper({ children, index }: { children: React.ReactNode, index: number }) {
  return (
    <AnimatePresence mode="sync">
      <motion.div
        key={index}
        className="absolute w-full h-full flex items-center justify-center"
        variants={slideVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
