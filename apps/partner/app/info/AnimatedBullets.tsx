// AnimatedBullets.tsx
import { motion, Variants } from 'framer-motion';

const listVariants: Variants = {
  animate: { transition: { staggerChildren: 0.3 } }
};

const bulletVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export function AnimatedBullets({ items }: { items: string[] }) {
  return (
    <motion.ul
      className="text-xl space-y-2"
      variants={listVariants}
      initial="initial"
      animate="animate"
    >
      {items.map((text, i) => (
        <motion.li key={i} variants={bulletVariants}>
          {text}
        </motion.li>
      ))}
    </motion.ul>
  );
}
