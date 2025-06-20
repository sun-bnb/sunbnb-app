'use client'

import logger from '@/utils/logger'

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
    } else {
      setContent(<AuthenticatedApp>{children}</AuthenticatedApp>)
    }
  }, [status])

  return content

}

export default App