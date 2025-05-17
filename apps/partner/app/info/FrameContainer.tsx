import { AnimatePresence } from 'framer-motion';

export function FrameContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[200px] w-full relative border border-[2px] border-red overflow-hidden">
      <AnimatePresence mode="wait">
        {children}
      </AnimatePresence>
    </div>
  );
}
