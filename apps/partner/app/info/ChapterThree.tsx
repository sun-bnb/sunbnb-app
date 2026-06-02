import { useState, useEffect } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { FrameWrapper } from './FrameWrapper'
import { AnimatedBulletsWithIcons } from './AnimatedBulletsWithIcons'
import { MultimediaFrame } from './MultimediaFrame'
import { TypingText } from './TypingText'
import reservationCapture from './reservation-capture.gif'
import checkInBeach from './check-in-beach.png'

export default function ChapterThree() {

  const t = useTranslations('Info')

  const frames = [
    <MultimediaFrame layout="horizontal"
      illustration={<Image alt="Reserve & Pay" src={reservationCapture} className="shadow" />}
      imageSize={30}
      animation="horizontalFlip"
      content={
        <AnimatedBulletsWithIcons size={16} animation="up" bullets={[
          { icon: '💳', text: t('ch3NoCash') },
          { icon: '📋', text: t('ch3ReservationManagement') },
          { icon: '🧾', text: t('ch3CustomerReceipt') },
        ]} />
      }
      imageFirst
    />,
    <MultimediaFrame layout="horizontal"
      illustration={<Image alt="Check In" src={checkInBeach} className="w-full" style={{ width: '100%' }} />}
      imageSize={45}
      animation="fadeInOut"
      content={
        <AnimatedBulletsWithIcons animation="up" size={15} bullets={[
          { icon: '🏖️', text: t('ch3FindSunbeds') },
          { icon: '✅', text: t('ch3DirectCheckIn') },
        ]} />
      }
      imageFirst={false}
    />,
    <MultimediaFrame layout="vertical"
      illustration={<motion.div className="text-[90px]">🧑💬</motion.div>}
      imageSize={75}
      animation="fadeInOut"
      content={<TypingText text={t('ch3CustomerFeedback')} />}
      imageFirst={false}
    />
  ];

  const [index, setIndex] = useState(0);
  const durations = [8000, 6000, 4000];

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
