import { useState, useEffect } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { FrameWrapper } from './FrameWrapper'
import { AnimatedBulletsWithIcons } from './AnimatedBulletsWithIcons'
import { MultimediaFrame } from './MultimediaFrame'
import { TypingText } from './TypingText'
import { StaggeredReveal } from './StaggeredReveal'
import receiptSample from './receipt-sample.png'
import taxAccounting from './tax-accounting.png'

const frames = [
  <MultimediaFrame layout="horizontal"
    illustration={<Image alt="Tax Accounting" src={taxAccounting} className="shadow" />}
    imageSize={30}
    animation="slideToLeft"
    content={
      <AnimatedBulletsWithIcons size={16} animation="left" bullets={[
            { icon: '🏦', text: 'Tax accounting' },
            { icon: '💳', text: 'Transaction history' },
            { icon: '📈', text: 'Income dashboard' }
          ]} />
    }
    imageFirst={true}
  />,
  <MultimediaFrame layout="horizontal"
    illustration={<Image alt="Customer receipts" src={receiptSample} className="shadow" />}
    imageSize={40}
    animation="horizontalFlip"
    content={
      <AnimatedBulletsWithIcons size={16} animation="up" bullets={[
        { icon: '🧾', text: 'Customer receipts' },
        { icon: '📄', text: 'Accounting documents' }
      ]} />
    }
    imageFirst={false}
  />
];

export default function ChapterFour() {

  const [index, setIndex] = useState(0);
  const durations = [6000, 6000];

  useEffect(() => {
    if (index < frames.length - 1) {
      const timer = setTimeout(() => setIndex(index + 1), durations[index]);
      return () => clearTimeout(timer);
    }
  }, [index]);

  return (
    <div className="relative w-full h-[200px] overflow-hidden">
      <FrameWrapper index={index}>
        {frames[index]}
      </FrameWrapper>
    </div>
  );
}