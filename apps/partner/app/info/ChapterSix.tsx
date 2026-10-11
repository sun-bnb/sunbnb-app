import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { FrameWrapper } from './FrameWrapper'
import { AnimatedBulletsWithIcons } from './AnimatedBulletsWithIcons'
import { MultimediaFrame } from './MultimediaFrame'
import { TypingText } from './TypingText'

// The built-in AI assistant (track 030). Claims mirror apps/partner/CLAUDE.md § AI assistant —
// layout from a plan or drone photo, document fill-in, tab edits with Undo, own-data questions.
export default function ChapterSix() {

  const t = useTranslations('Info')

  const frames = [
    <MultimediaFrame layout="horizontal"
      header={<div className="text-[20px]">{t('ch6Heading')}</div>}
      illustration={<div style={{ fontSize: '72px' }}>💬</div>}
      imageSize={30}
      animation="slideToLeft"
      content={
        <AnimatedBulletsWithIcons size={16} animation="left" bullets={[
          { icon: '🏖️', text: t('ch6Layout') },
          { icon: '🗺️', text: t('ch6PlanPhoto') },
          { icon: '📏', text: t('ch6Distances') }
        ]} />
      }
      imageFirst
    />,
    <MultimediaFrame layout="horizontal"
      illustration={<div style={{ fontSize: '72px' }}>📄</div>}
      imageSize={30}
      animation="horizontalFlip"
      content={
        <AnimatedBulletsWithIcons size={16} animation="up" bullets={[
          { icon: '🗂️', text: t('ch6Documents') },
          { icon: '🏷️', text: t('ch6Prices') },
          { icon: '↩️', text: t('ch6Undo') }
        ]} />
      }
      imageFirst={false}
    />,
    <MultimediaFrame layout="vertical"
      illustration={<div className="text-[90px]">📊</div>}
      imageSize={75}
      animation="fadeInOut"
      content={<TypingText text={t('ch6Questions')} />}
      imageFirst={false}
    />
  ];

  const [index, setIndex] = useState(0);
  const durations = [6000, 6000, 4000];

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
