'use client'

import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
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

// ─── Mollie banner ────────────────────────────────────────────────────────────

type MollieOnboardingStatus = 'completed' | 'in-review' | 'needs-data' | null

function MollieBanner({
  hasMollie,
  mollieOnboardingStatus,
  hasIntegratedPayments,
}: {
  hasMollie: boolean
  mollieOnboardingStatus: MollieOnboardingStatus
  hasIntegratedPayments: boolean
}) {
  // Only show when at least one site uses integrated payments
  if (!hasIntegratedPayments) return null

  // No banner needed when Mollie is fully set up
  if (hasMollie && mollieOnboardingStatus === 'completed') return null

  const reason = 'One or more of your sites has integrated payments enabled for reservations, orders, or equipment rentals.'

  // Not connected at all
  if (!hasMollie) {
    return (
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-400/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm text-amber-800">
                <span className="font-medium">Mollie Payments not connected.</span>
                {' '}Connect your Mollie account to accept online payments.
              </p>
              <p className="text-xs text-amber-600 mt-0.5">{reason}</p>
            </div>
          </div>
          <Link
            href="/account/mollie"
            className="flex-shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            Set up Mollie
          </Link>
        </div>
      </div>
    )
  }

  // Connected but needs-data
  if (mollieOnboardingStatus === 'needs-data') {
    return (
      <div className="bg-orange-50 border-b border-orange-200">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-400/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm text-orange-800">
                <span className="font-medium">Mollie onboarding incomplete.</span>
                {' '}Your account needs additional information before you can accept payments.
              </p>
              <p className="text-xs text-orange-600 mt-0.5">{reason}</p>
            </div>
          </div>
          <a
            href="https://my.mollie.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            Complete at Mollie ↗
          </a>
        </div>
      </div>
    )
  }

  // in-review — informational only, lower urgency
  if (mollieOnboardingStatus === 'in-review') {
    return (
      <div className="bg-blue-50 border-b border-blue-200">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-400/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm text-blue-800">
                <span className="font-medium">Mollie account under review.</span>
                {' '}Payments will be enabled once your account is verified. No action needed.
              </p>
              <p className="text-xs text-blue-500 mt-0.5">{reason}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ─── App shell ────────────────────────────────────────────────────────────────

export default function App({ children, businessEntity }: { children: React.ReactNode; businessEntity: BusinessEntity }) {

  const { status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [hasMollie, setHasMollie] = useState(false)
  const [mollieOnboardingStatus, setMollieOnboardingStatus] = useState<MollieOnboardingStatus>(null)
  const [hasIntegratedPayments, setHasIntegratedPayments] = useState(false)

  // Public routes that don't need auth shell
  const isPublicRoute = pathname.endsWith('/info') || pathname.endsWith('/manage') || pathname.endsWith('/orders') || pathname.startsWith('/sign-in') || pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password') || pathname.startsWith('/legal')

  // Routes where the onboarding guard should not redirect
  const isOnboardingRoute = pathname.startsWith('/onboarding')

  // Don't show the banner when the user is already on the Mollie setup page
  const isMolliePage = pathname.startsWith('/account/mollie')

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
        } else {
          setNeedsOnboarding(false)
          setHasMollie(!!data.hasMollie)
          setMollieOnboardingStatus(data.mollieOnboardingStatus ?? null)
          setHasIntegratedPayments(!!data.hasIntegratedPayments)
        }
        setOnboardingChecked(true)
      })
      .catch(() => {
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
      {!isMolliePage && (
        <MollieBanner hasMollie={hasMollie} mollieOnboardingStatus={mollieOnboardingStatus} hasIntegratedPayments={hasIntegratedPayments} />
      )}
      <main>
        {children}
      </main>
    </div>
  )
}
