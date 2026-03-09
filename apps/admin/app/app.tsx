'use client'

import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Header from './header'

export default function App({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const isPublicRoute = pathname.startsWith('/sign-in') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password')

  useEffect(() => {
    if (status === 'unauthenticated' && !isPublicRoute) {
      router.push('/sign-in')
    }
  }, [status, isPublicRoute]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isPublicRoute) {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gray-700 border-t-purple-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (status !== 'authenticated') {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <main>
        {children}
      </main>
    </div>
  )
}
