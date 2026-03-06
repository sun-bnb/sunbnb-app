'use client'

import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import Header from './header'
import LandingPage from './landing'

export default function App({ children }: { children: React.ReactNode }) {

  const { status } = useSession()
  const pathname = usePathname()

  // Public routes that don't need auth shell
  const isPublicRoute = pathname.endsWith('/info') || pathname.endsWith('/manage') || pathname.endsWith('/orders')

  if (isPublicRoute) {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <LandingPage />
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Header />
      <main>
        {children}
      </main>
    </div>
  )
}
