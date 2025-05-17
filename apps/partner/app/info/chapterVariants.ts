export const slideLeftVariants = {
  initial: { x: '100%', opacity: 1 },
  animate: { x: 0, opacity: 1, transition: { duration: 0.5 } },
  exit: { x: '-100%', opacity: 0, transition: { duration: 0.5 } },
};

export const slideUpVariants = {
  initial: { y: '100%', opacity: 1 },
  animate: { y: 0, opacity: 1, transition: { duration: 0.5 } },
  exit: { y: '-100%', opacity: 0, transition: { duration: 0.5 } },
};
