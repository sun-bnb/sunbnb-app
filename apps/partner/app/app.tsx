'use client'

import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
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

/**
 * Collapse missing OAuth scopes into the capabilities a partner would recognise
 * — nobody should be shown "refunds.write". Read/write pairs fold into one
 * entry, and order follows the scope list so the copy is deterministic.
 */
const SCOPE_CAPABILITY: Record<string, string> = {
  'payments.read': 'payments',
  'payments.write': 'payments',
  'refunds.read': 'refunds',
  'refunds.write': 'refunds',
  'profiles.read': 'profile',
  'profiles.write': 'profile',
  'onboarding.read': 'onboarding',
  'onboarding.write': 'onboarding',
}

function missingCapabilities(missingScopes: string[]): string[] {
  const capabilities: string[] = []
  for (const scope of missingScopes) {
    // Fall back to the raw scope id for a scope added without a label — better
    // a developer-ish word than a crash or a silently empty list.
    const capability = SCOPE_CAPABILITY[scope] ?? scope
    if (!capabilities.includes(capability)) capabilities.push(capability)
  }
  return capabilities
}

function MollieBanner({
  hasMollie,
  mollieOnboardingStatus,
  hasIntegratedPayments,
  missingScopes,
}: {
  hasMollie: boolean
  mollieOnboardingStatus: MollieOnboardingStatus
  hasIntegratedPayments: boolean
  missingScopes: string[]
}) {
  const t = useTranslations('App')

  // Only show when at least one site uses integrated payments
  if (!hasIntegratedPayments) return null

  const reason = t('mollieIntegratedReason')

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
              <p className="text-sm text-amber-800">{t('mollieNotConnected')}</p>
              <p className="text-xs text-amber-600 mt-0.5">{reason}</p>
            </div>
          </div>
          <Link
            href="/account/mollie"
            className="flex-shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            {t('connectMollie')}
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
              <p className="text-sm text-orange-800">{t('mollieNeedsData')}</p>
              <p className="text-xs text-orange-600 mt-0.5">{reason}</p>
            </div>
          </div>
          <div className="flex-shrink-0 flex items-center gap-3">
            <a
              href="https://my.mollie.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-orange-700 hover:text-orange-900 hover:underline"
            >
              {t('completeMollie')}
            </a>
            <Link
              href="/account/mollie"
              className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors"
            >
              {t('continueSetup')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Connected and onboarded, but the OAuth grant is missing scopes we need.
  // Ranked below needs-data (which blocks payments outright) and above
  // in-review, since payments still work — it is the extras that fail, and they
  // fail as a 403 in front of whoever tries first, usually floor staff.
  // Re-consent is the only fix: /api/mollie/authorize re-prompts with the
  // current scope set (approval_prompt=force), because a token refresh never
  // widens an existing grant.
  if (missingScopes.length > 0) {
    const capabilities = missingCapabilities(missingScopes)
      .map((capability) => {
        switch (capability) {
          case 'payments': return t('molliePermissionPayments')
          case 'refunds': return t('molliePermissionRefunds')
          case 'profile': return t('molliePermissionProfile')
          case 'onboarding': return t('molliePermissionOnboarding')
          default: return capability
        }
      })
      .join(', ')

    return (
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-400/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1.001.43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm text-amber-800">{t('mollieMissingPermissions')}</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {t('mollieMissingPermissionsDetail', { capabilities })}
              </p>
            </div>
          </div>
          {/* No returnTo: the default landing is /account/mollie?success=true,
              which refreshes the session so this banner clears right away. */}
          <a
            href="/api/mollie/authorize"
            className="flex-shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            {t('updateMolliePermissions')}
          </a>
        </div>
      </div>
    )
  }

  // in-review — informational, lower urgency, but link partners to details
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
              <p className="text-sm text-blue-800">{t('mollieInReview')}</p>
              <p className="text-xs text-blue-500 mt-0.5">{reason}</p>
            </div>
          </div>
          <Link
            href="/account/mollie"
            className="flex-shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline"
          >
            {t('viewMollieDetails')}
          </Link>
        </div>
      </div>
    )
  }

  return null
}

// ─── App shell ────────────────────────────────────────────────────────────────

export default function App({ children, businessEntity }: { children: React.ReactNode; businessEntity: BusinessEntity }) {

  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [hasMollie, setHasMollie] = useState(false)
  const [mollieOnboardingStatus, setMollieOnboardingStatus] = useState<MollieOnboardingStatus>(null)
  const [hasIntegratedPayments, setHasIntegratedPayments] = useState(false)

  // Public routes that don't need auth shell.
  // The /manage surface is token-gated (not session-gated), so all sub-routes
  // under /manage (landing + /sunbeds + /summary) must be public here.
  const isPublicRoute =
    pathname.endsWith('/info') ||
    pathname.includes('/manage') ||
    pathname.endsWith('/orders') ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/legal')

  // Routes where the onboarding guard should not redirect
  const isOnboardingRoute = pathname.startsWith('/onboarding')

  // Don't show the banner when the user is already on the Mollie setup page
  const isMolliePage = pathname.startsWith('/account/mollie')

  // Stamped onto the token at sign-in (see the `jwt` callback in app/auth.ts),
  // so this needs no fetch of its own and stays fixed for the session.
  const missingScopes: string[] =
    (session?.user as { missingMollieScopes?: string[] } | undefined)?.missingMollieScopes ?? []

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
        <MollieBanner
          hasMollie={hasMollie}
          mollieOnboardingStatus={mollieOnboardingStatus}
          hasIntegratedPayments={hasIntegratedPayments}
          missingScopes={missingScopes}
        />
      )}
      <main>
        {children}
      </main>
    </div>
  )
}
