'use client'

import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { ReactNode, useEffect, useState } from 'react'
import Header from './header'

const App = ({ children }: {
  children: React.ReactNode;
}) => {

  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const [ content, setContent ] = useState<ReactNode | null>(null)

  console.log('root session', session)
  

  useEffect(() => {
    console.log(status)
    if (pathname.includes('/pos') || pathname.includes('/complete/item')) {
      setContent(
        <div>
          {children}
        </div>
      )
    } else if (status === 'authenticated' || pathname === '/privacy' || pathname === '/tos') {
      setContent(
        <div>
          <Header />
          <div className="flex max-w-lg mx-auto">
            <div className="flex-grow lg:p-6">
              {children}
            </div>
          </div>
        </div>
        
      )
      console.log(session)
    } else if (status === 'unauthenticated') {
      router.push('/api/auth/signin')
    }
  }, [status])

  return content

}

export default App