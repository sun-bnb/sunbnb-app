import { useState, useEffect } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { FrameWrapper } from './FrameWrapper'
import { AnimatedBulletsWithIcons } from './AnimatedBulletsWithIcons'
import { MultimediaFrame } from './MultimediaFrame'
import { TypingText } from './TypingText'
import { StaggeredReveal } from './StaggeredReveal'
import reservationCapture from './reservation-capture.gif'
import checkInBeach from './check-in-beach.png'

export default function ChapterFour() {

  const t = useTranslations('Info')

  const frames = [
    <MultimediaFrame layout="horizontal"
      header={<div className="text-[20px]">{t('ch4InAppPurchases')}</div>}
      illustration={<div style={{ fontSize: '72px' }}>🛒</div>}
      imageSize={30}
      animation="slideToLeft"
      content={
        <AnimatedBulletsWithIcons size={16} animation="left" bullets={[
              { icon: '🍺', text: t('ch4Drinks') },
              { icon: '🍔', text: t('ch4Food') },
              { icon: '🏄', text: t('ch4Rentals') }
            ]} />
      }
      imageFirst
    />,
    <MultimediaFrame layout="vertical"
      illustration={<StaggeredReveal
        elements={[
          <div className="text-[42px]">🎁</div>,
          <div className="text-[42px]">🏷️</div>,
          <div className="text-[42px]">💵</div>,
        ]}
        delay={0.5}
        stagger={1}
        duration={1}
      />}
      imageSize={80}
      animation="none"
      content={
        <div className="text-[20px]">{t('ch4Discounts')}</div>
      }
      imageFirst
    />
  ];

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
