'use client'

import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { ReactNode, useEffect, useState, useRef } from 'react'
import Header from './header/header'
import AuthenticatedApp from './authenticatedApp'

const App = ({ children }: {
  children: React.ReactNode;
}) => {

  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const [ content, setContent ] = useState<ReactNode | null>(null)
  const [hideHeader, setHideHeader] = useState<boolean>(false)
  const lastScrollY = useRef(0)

  console.log('root session', session)

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
  

  useEffect(() => {
    console.log(status)
    if (pathname.includes('/pos') || pathname.includes('/receipt') || pathname.includes('/pass') || (pathname.includes('/complete') && status !== 'authenticated')) {
      setContent(
        <div>
          {children}
        </div>
      )
    } else if (status === 'authenticated' || pathname === '/privacy' || pathname === '/tos') {
      setContent(<AuthenticatedApp>{children}</AuthenticatedApp>)
      console.log(session)
    } else if (status === 'unauthenticated') {
      router.push('/api/auth/signin')
    }
  }, [status])

  return content

}

export default App