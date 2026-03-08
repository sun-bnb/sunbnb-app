'use client'

import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Header from './header'
import LandingPage from './landing'

interface BusinessEntity {
  companyName: string
  companyAddress: string | null
  businessId: string | null
  vatId: string | null
  contactEmail: string | null
  contactPhone: string | null
}

export default function App({ children, businessEntity }: { children: React.ReactNode; businessEntity: BusinessEntity }) {

  const { status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  // Public routes that don't need auth shell
  const isPublicRoute = pathname.endsWith('/info') || pathname.endsWith('/manage') || pathname.endsWith('/orders') || pathname.startsWith('/sign-in') || pathname.startsWith('/legal')

  // Routes where the onboarding guard should not redirect
  const isOnboardingRoute = pathname.startsWith('/onboarding')

  useEffect(() => {
    if (status !== 'authenticated' || isPublicRoute || isOnboardingRoute) {
      setOnboardingChecked(true)
      return
    }

    fetch('/api/onboarding-status')
      .then((res) => res.json())
      .then((data) => {
        if (!data.hasAccount) {
          setNeedsOnboarding(true)
          router.replace('/onboarding')
        }
        setOnboardingChecked(true)
      })
      .catch(() => {
        // If the check fails, don't block the user
        setOnboardingChecked(true)
      })
  }, [status, pathname])

  if (isPublicRoute) {
    return <>{children}</>
  }

  if (status === 'loading' || (status === 'authenticated' && !onboardingChecked)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <LandingPage businessEntity={businessEntity} />
  }

  // Show onboarding without header chrome
  if (isOnboardingRoute) {
    return <>{children}</>
  }

  // If still redirecting to onboarding, show spinner
  if (needsOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    )
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
