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
  },
  frame4: {
    opacity: 0,
    y: 20,
  },
  frame5: {
    marginTop: '20px',
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.8,
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
    transition: { duration: 0.6, ease: 'easeOut' },
  },
};

export const chapterContainerVariants: Variants = {
  collapsed: { height: 0, width: 0, opacity: 0 },
  expanded: {
    height: '230px',
    width: 'calc(100% - 20px)',
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
};

export const chapter1Part1Variants: Variants = {
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

export const chapter1Part2Variants: Variants = {
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

export const chapter1Frames: { [frame: string]: { [elem: string]: Variants }} = {
  frame0: {
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
    'SubTitle1': {
      frame0: { left: '100%' },
      frame1: {
        left: '0px',
        transition: { duration: 2, ease: 'easeOut' },
      },
      frame2: {
        left: '0px',
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame3: {
        left: '0px',
        transition: { duration: 1, ease: 'easeOut' },
      },
      frame4: {
        left: '0px',
        transition: { duration: 1, ease: 'easeOut' },
      },
    },
    'CheckInContainer': {
      frame0: { height: 0, width: 0, opacity: 0 },
      frame1: {
        width: '100%',
        height: '160px',
        opacity: 1,
        transition: { duration: 0, ease: 'easeOut' },
      },
      frame2: {
        width: '100%',
        height: '160px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame3: {
        width: '100%',
        height: '160px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame4: {
        width: '100%',
        height: '160px',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
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
  },
  frame1: {
    'Title1': {
      frame0: { height: 0, opacity: 0 },
      frame1: { height: 0, opacity: 0 },
      frame2: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame3: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }
    },
    'CheckIn1': {
      frame0: { height: 0, opacity: 0 },
      frame1: { height: 0, opacity: 0 },
      frame2: { height: 0, opacity: 0 },
      frame3: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }
    }
  },
  frame2: {
    'Title1': {
      frame0: { height: 0, opacity: 0 },
      frame1: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame2: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame3: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }
    },
    'CheckIn1': {
      frame0: { height: 0, opacity: 0 },
      frame1: { height: 0, opacity: 0 },
      frame2: { height: 0, opacity: 0 },
      frame3: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }
    }
  },
  frame3: {
    'Title1': {
      frame0: { height: 0, opacity: 0 },
      frame1: { height: 0, opacity: 0 },
      frame2: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      },
      frame3: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }
    },
    'CheckIn1': {
      frame0: { height: 0, opacity: 0 },
      frame1: { height: 0, opacity: 0 },
      frame2: { height: 0, opacity: 0 },
      frame3: {
        height: 'auto',
        opacity: 1,
        transition: { duration: 0.3, ease: 'easeOut' },
      }
    }
  }
}