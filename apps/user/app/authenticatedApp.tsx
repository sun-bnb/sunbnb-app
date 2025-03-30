'use client'

import { useEffect, useState, useRef } from 'react'
import Header from './header/header'

const MIN_SCROLL = 100
const HIDE_THRESHOLD = 20
const SHOW_THRESHOLD = 1

const AuthenticatedApp = ({ children }: {
  children: React.ReactNode;
}) => {

  const [hideHeader, setHideHeader] = useState<boolean>(false)
  const lastScrollY = useRef(0)

  useEffect(() => {
    function handleScroll() {
      const currentScrollY = window.scrollY;

      // If we haven't scrolled beyond MIN_SCROLL, never hide
      if (currentScrollY < MIN_SCROLL) {
        setHideHeader(false);
      } else {
        // Compare current scroll to last scroll
        const diff = currentScrollY - lastScrollY.current;

        if (diff > HIDE_THRESHOLD) {
          // Scrolled down enough => hide
          setHideHeader(true);
        } else if (diff < -SHOW_THRESHOLD) {
          // Scrolled up enough => show
          setHideHeader(false);
        }
      }

      // Update last scroll
      lastScrollY.current = currentScrollY;
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  return (
    <div>
      <div
        className={`
          fixed top-0 left-0 right-0 z-50
          transition-transform duration-300
          bg-white shadow-md
          ${hideHeader ? '-translate-y-full' : 'translate-y-0'}
        `}
      >
        <Header />
      </div>
      <div className="flex max-w-lg mx-auto bg-[#fff5e1] pt-[12px]">
        <div className="flex-grow lg:p-6">
          {children}
        </div>
      </div>
    </div>  
  )

}

export default AuthenticatedApp