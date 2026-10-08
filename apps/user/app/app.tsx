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

  useEffect(() => {
    if (
      pathname.includes('/demo') ||
      pathname.includes('/pos') ||
      // The short QR entry (track 022) is the same chrome-free landing as /pos.
      // startsWith, not includes: '/q' as a substring would match unrelated paths.
      pathname.startsWith('/q/') ||
      // A guest's SUNBED reservation page now gets the app header (a way back
      // into the app). The table-deposit page keeps its chrome-free guest view:
      // it is a return target for embedded restaurant flows.
      (pathname.startsWith('/table-reservations') && status === 'unauthenticated') ||
      pathname.includes('/receipt') || 
      pathname.includes('/pass') || 
      pathname.startsWith('/sign-in') ||
      pathname.startsWith('/forgot-password') ||
      pathname.startsWith('/reset-password') ||
      pathname.startsWith('/s/') ||
      pathname.startsWith('/embed') ||
      pathname.startsWith('/tables/') ||
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