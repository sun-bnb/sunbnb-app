// animations.ts
import { Variants } from 'framer-motion';

export const logoVariants: Variants = {
  hidden: {
    x: '50vw',
    y: '30vh',
    translateX: '-50%',
    translateY: '-50%',
    opacity: 1,
    scale: 0.2,
  },
  // Fade + scale into the center
  center: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 1.2,
      ease: 'easeOut',
    },
  },
  // Move and shrink to the top-left corner
  corner: {
    x: -60,
    y: -50,
    translateX: 0,
    translateY: 0,
    scale: 0.25,
    transition: {
      duration: 1.0,
      ease: 'easeInOut',
    }
  }
};

export const sloganVariants: Variants = {
  hidden: {
    x: '50vw',
    y: '120vh',
    translateX: '-50%',
    fontSize: '24ox',
    opacity: 1,
    scale: 0.5,
  },
  // Fade + scale into the center
  center: {
    x: '50vw',
    y: '60vh',
    translateX: '-50%',
    opacity: 1,
    scale: 0.8,
    fontSize: '32px',
    transition: {
      duration: 1.2,
      ease: 'easeOut',
    },
  },
  // Move and shrink to the top-left corner
  top: {
    x: 'calc(50vw + 20px)',
    y: '4px',
    translateX: '-50%',
    scale: 0.7,
    fontSize: '24px',
    transition: {
      duration: 1.0,
      ease: 'easeInOut',
    }
  }
};

// For your upcoming chapter titles animations, e.g. fade in or slide up
export const chapterVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: 'easeOut'
    }
  }
};

export const chaptersContainerVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: 'easeOut'
    }
  },
  closed: {
    bottom: 20,
    transition: {
      type: 'spring',
      stiffness: 200,
      damping: 25,
    },
  },
  open: {
    bottom: 200, // or wherever you want it to slide up
    transition: {
      type: 'spring',
      stiffness: 150,
      damping: 20,
    },
  },
};

// For the list of chapters (li items).
// We'll use "staggerChildren" inside the container.
export const chaptersListVariants: Variants = {
  hidden: {
    // We keep them visible but you could do other animations
    transition: {
      staggerChildren: 0.5,
    },
  },
  visible: {
    transition: {
      staggerChildren: 0.5,
    },
  },
};

// For each list item's title row (the clickable area).
export const chapterItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: 'easeOut'
    }
  }
};

// For the "expanded" content (the accordion part).
// We'll animate height from 0 to "auto" using framer-motion's layout or custom styles.
export const chapterContentVariants: Variants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
};
