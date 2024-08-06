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

  const [ content, setContent ] = useState<ReactNode | null>(null)

  useEffect(() => {
    console.log(status)
    if (status === 'authenticated') {
      setContent(
        <div>
          <Header />
          <div className="flex">
            <div className="flex-grow p-6">
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