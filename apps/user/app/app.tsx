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

  logger.debug('root session', session)

  useEffect(() => {
    if (
      pathname.includes('/pos') || 
      pathname.includes('/receipt') || 
      pathname.includes('/pass') || 
      (pathname.includes('/complete') && status !== 'authenticated')) {
      setContent(
        <div>
          {children}
        </div>
      )
    } else if (status === 'authenticated' || pathname === '/privacy' || pathname === '/tos') {
      setContent(<AuthenticatedApp>{children}</AuthenticatedApp>)
    } else if (status === 'unauthenticated') {
      router.push('/api/auth/signin')
    }
  }, [status])

  return content

}

export default App