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

  useEffect(() => {
    if (pathname.endsWith('/info') || pathname.endsWith('/manage') || pathname.endsWith('/orders')) {
      setContent(
        <div>
          {children}
        </div>
      )
    } else if (status === 'authenticated') {
      setContent(
        <div>
          { !(pathname.includes('/manage') || pathname.includes('/orders')) && <Header /> }
          <div className="flex">
            <div className="flex-grow">
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