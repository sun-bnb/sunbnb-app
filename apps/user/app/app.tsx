'use client'

import logger from '@/utils/logger'

import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { ReactNode, useEffect, useState, useRef } from 'react'
import Header from './header/header'
import AuthenticatedApp from './authenticated-app'
import UnauthenticatedApp from './unauthenticated-app'

const App = ({ children }: {
  children: React.ReactNode;
}) => {

  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const [ content, setContent ] = useState<ReactNode | null>(null)

  console.log('App rendered with status:', status, 'and pathname:', pathname)
  
  useEffect(() => {
    if (
      pathname.includes('/pos') ||
      (pathname.includes('/reservations') && status === 'unauthenticated') ||
      pathname.includes('/receipt') || 
      pathname.includes('/pass') || 
      (pathname.includes('/complete') && status !== 'authenticated')) {
      setContent(
        <div>
          {children}
        </div>
      )
    } else if (pathname === '/') {
      setContent(<UnauthenticatedApp>{children}</UnauthenticatedApp>)
    } else {
      setContent(<AuthenticatedApp>{children}</AuthenticatedApp>)
    }
  }, [status, pathname])

  return content

}

export default App