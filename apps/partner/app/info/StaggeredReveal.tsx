import { motion, Variants } from 'framer-motion';
import { ReactNode } from 'react';

type Props = {
  elements: ReactNode[];
  delay?: number;          // Delay before starting reveal
  stagger?: number;        // Delay between items
  duration?: number;       // Duration of each item's animation
};

const containerVariants = (delay: number, stagger: number): Variants => ({
  animate: {
    transition: {
      delay,
      staggerChildren: stagger,
    },
  },
});

const itemVariants = (duration: number): Variants => ({
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration,
      ease: 'easeOut',
    },
  },
});

export function StaggeredReveal({
  elements,
  delay = 0,
  stagger = 0.3,
  duration = 0.4,
}: Props) {
  return (
    <motion.div
      className="flex flex-col space-y-2 w-full items-center justify-center"
      style={{ flexDirection: 'row' }}
      variants={containerVariants(delay, stagger)}
      initial="initial"
      animate="animate"
    >
      {elements.map((el, i) => (
        <motion.div key={i} variants={itemVariants(duration)} className="mx-[12px]">
          {el}
        </motion.div>
      ))}
    </motion.div>
  );
}
