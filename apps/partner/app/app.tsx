'use client'

import Sidebar from "@/components/sidebar"
import Home from './page'
import { signIn } from 'next-auth/react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ReactNode, useEffect, useState } from "react"

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
        <div className="flex">
          <Sidebar />
          <div className="flex-grow ml-64 p-6">
            {children}
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