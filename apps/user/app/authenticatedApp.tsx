'use client'

import { useEffect, useState, useRef } from 'react'
import Header from './header/header'

const AuthenticatedApp = ({ children }: {
  children: React.ReactNode;
}) => {

  const [hideHeader, setHideHeader] = useState<boolean>(false)
  const lastScrollY = useRef(0)

  useEffect(() => {
    function handleScroll() {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current) {
        // user is scrolling DOWN
        setHideHeader(true);
      } else {
        // user is scrolling UP
        setHideHeader(false);
      }
      lastScrollY.current = currentScrollY;
    }

    window.addEventListener('scroll', handleScroll);
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