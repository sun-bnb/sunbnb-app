import { motion, Variants } from 'framer-motion';
import { ReactNode } from 'react';

const listVariants: Variants = {
  animate: { transition: { duration: 2, staggerChildren: 1 } }
};

const itemVariants: Variants = {
  initial: { opacity: 1, x: 200 },
  animate: { opacity: 1, x: 0, transition: { duration: 2 } }
};

const animations: {
  [key: string]: Variants
} = {
  'up': {
    initial: { opacity: 1, y: 200 },
    animate: { opacity: 1, y: 0, transition: { duration: 1 } }
  },
  'left': {
    initial: { opacity: 1, x: 230 },
    animate: { opacity: 1, x: 0, transition: { duration: 1 } }
  }
}

type Bullet = { icon: ReactNode; text: string };

export function AnimatedBulletsWithIcons({ bullets, size, animation }: { bullets: Bullet[], size: number, animation: 'up' | 'left' }) {
  return (
    <motion.ul
      className="text-base px-1 space-y-2"
      variants={listVariants}
      initial="initial"
      animate="animate"
    >
      {bullets.map((b, i) => (
        <motion.li key={i} variants={animations[animation]} className="flex items-center gap-2">
          <div style={{ fontSize: `${20}px` }}>{b.icon}</div>
          <div style={{ fontSize: `${size}px` }}>{b.text}</div>
        </motion.li>
      ))}
    </motion.ul>
  );
}
