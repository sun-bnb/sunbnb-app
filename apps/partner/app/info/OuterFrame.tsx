import { motion, Variants } from 'framer-motion';

type Props = {
  children: React.ReactNode;
  custom: number;
  variants: Variants;
};

export function OuterFrame({ children, custom, variants }: Props) {
  return (
    <motion.div
      className="w-full h-auto absolute pt-[16px] border border-[2px] border-black"
      custom={custom}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}
