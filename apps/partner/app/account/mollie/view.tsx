'use client'

import { useState } from 'react'
import { disconnectMollie, refreshMollieTokens } from './actions'

interface PartnerData {
  firstName: string
  lastName: string
  email: string
  company: string
  address: string
}

interface MollieViewProps {
  isConnected: boolean
  profileId: string | null
  onboardingStatus: string | null
  success: boolean
  error: string | null
  partnerData: PartnerData | null
}

/* ── Status badge ────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null

  const config: Record<string, { bg: string; text: string; label: string }> = {
    'completed':  { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Verified' },
    'in-review':  { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'In review' },
    'needs-data': { bg: 'bg-orange-50',   text: 'text-orange-700',  label: 'Needs data' },
  }

  const cfg = config[status] ?? { bg: 'bg-gray-50', text: 'text-gray-600', label: status }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  )
}

/* ── Main view ───────────────────────────────────────────────────────────── */

export default function MollieView({ isConnected, profileId, onboardingStatus, success, error, partnerData }: MollieViewProps) {

  const [disconnecting, setDisconnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tab, setTab] = useState<'existing' | 'new'>('existing')

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Mollie account? Customers will not be able to pay via Mollie until you reconnect.')) return
    setDisconnecting(true)
    setActionError(null)
    const result = await disconnectMollie()
    if (result.status === 'error') {
      setActionError(result.message ?? 'Failed to disconnect')
    }
    setDisconnecting(false)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setActionError(null)
    const result = await refreshMollieTokens()
    if (result.status === 'error') {
      setActionError(result.message ?? 'Failed to refresh')
    }
    setRefreshing(false)
  }

  const readableError = (err: string) => {
    const map: Record<string, string> = {
      not_authenticated: 'You must be signed in to connect your Mollie account.',
      missing_params: 'Authorization failed — missing parameters from Mollie.',
      invalid_state: 'Authorization failed — invalid state. Please try again.',
      token_exchange_failed: 'Could not complete connection with Mollie. Please try again.',
      access_denied: 'You denied access to your Mollie account.',
    }
    return map[err] ?? `Authorization error: ${err}`
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Mollie Payments</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Connect your Mollie account to accept payments from customers
        </p>
      </div>

      {/* Success banner */}
      {success && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-sm text-emerald-800">Your Mollie account has been connected successfully!</p>
        </div>
      )}

      {/* Error banner */}
      {(error || actionError) && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-800">{error ? readableError(error) : actionError}</p>
        </div>
      )}

      {/* Connection status card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Connection status</h2>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <span className="w-2 h-2 rounded-full bg-gray-300" />
                Not connected
              </span>
            )}
          </div>
        </div>

        {isConnected ? (
          <>
            {/* Connected state — show details */}
            <div className="space-y-3 mb-5">
              {profileId && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Profile ID</span>
                  <span className="text-gray-900 font-mono text-xs">{profileId}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Onboarding</span>
                <StatusBadge status={onboardingStatus} />
              </div>
            </div>

            {onboardingStatus === 'needs-data' && (
              <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-800">
                  Your Mollie account requires additional information before you can accept payments.
                  Please complete your onboarding at{' '}
                  <a
                    href="https://my.mollie.com/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    my.mollie.com
                  </a>.
                </p>
              </div>
            )}

            {onboardingStatus === 'in-review' && (
              <div className="mb-5 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  Your Mollie account is being reviewed. You&apos;ll be able to accept payments once the review is complete.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                {refreshing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-500 rounded-full animate-spin" />
                    Refreshing…
                  </>
                ) : (
                  'Refresh status'
                )}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                {disconnecting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-red-300/30 border-t-red-400 rounded-full animate-spin" />
                    Disconnecting…
                  </>
                ) : (
                  'Disconnect'
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Disconnected state — tabbed approach */}
            <p className="text-sm text-gray-500 mb-4">
              Connect your Mollie account to start accepting iDEAL, credit/debit card, and other
              payment methods from your customers.
            </p>

            {/* Tab switcher */}
            <div className="flex border-b border-gray-200 mb-4">
              <button
                onClick={() => setTab('existing')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'existing'
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                I have a Mollie account
              </button>
              <button
                onClick={() => setTab('new')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'new'
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                New to Mollie
              </button>
            </div>

            {tab === 'existing' ? (
              <ExistingAccountTab />
            ) : (
              <ClientLinkTab partnerData={partnerData} onSwitchToExisting={() => setTab('existing')} />
            )}
          </>
        )}
      </div>

      {/* Info card */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">How it works</h2>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
            Connect your existing Mollie account, or create a new one right here using the &ldquo;New to Mollie&rdquo; tab — your details will be pre-filled.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
            Complete your Mollie onboarding (identity verification, bank account) if not done yet.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
            Once connected, payments from customers go directly to your Mollie account. A small platform fee is deducted automatically.
          </li>
        </ul>
      </div>

    </div>
  )
}

/* ── "I have a Mollie account" tab ───────────────────────────────────────── */

function ExistingAccountTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Log in to your existing Mollie account and authorize our platform to manage payments on your behalf.
      </p>
      <a
        href="/api/mollie/authorize"
        className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.122a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757" />
        </svg>
        Connect Mollie account
      </a>
    </div>
  )
}

/* ── "New to Mollie" tab — Client Link form ──────────────────────────────── */

const COUNTRY_OPTIONS = [
  { code: 'NL', label: 'Netherlands' },
  { code: 'BE', label: 'Belgium' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'AT', label: 'Austria' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'PT', label: 'Portugal' },
  { code: 'FI', label: 'Finland' },
  { code: 'SE', label: 'Sweden' },
  { code: 'DK', label: 'Denmark' },
  { code: 'NO', label: 'Norway' },
  { code: 'PL', label: 'Poland' },
  { code: 'IE', label: 'Ireland' },
]

function ClientLinkTab({ partnerData, onSwitchToExisting }: { partnerData: PartnerData | null; onSwitchToExisting: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)

    const form = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/mollie/client-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          givenName: form.get('givenName'),
          familyName: form.get('familyName'),
          organizationName: form.get('organizationName'),
          streetAndNumber: form.get('streetAndNumber'),
          postalCode: form.get('postalCode'),
          city: form.get('city'),
          country: form.get('country'),
          registrationNumber: form.get('registrationNumber'),
          vatNumber: form.get('vatNumber'),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'client_links_unavailable' || data.code === 'partner_status_required') {
          setUnavailable(true)
        }
        setFormError(data.error || 'Something went wrong')
        setSubmitting(false)
        return
      }

      // Redirect to the Mollie client link URL
      window.location.href = data.url
    } catch {
      setFormError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  // If client links aren't available, show a fallback with manual signup link
  if (unavailable) {
    return (
      <div>
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800 mb-2">
            Automatic account creation is not yet available. You can create a Mollie account manually and then connect it.
          </p>
          <ol className="text-sm text-amber-800 list-decimal list-inside space-y-1">
            <li>Create an account at <a href="https://my.mollie.com/signup" target="_blank" rel="noopener noreferrer" className="font-medium underline">my.mollie.com</a></li>
            <li>Switch to the <button onClick={onSwitchToExisting} className="font-medium underline">&ldquo;I have a Mollie account&rdquo;</button> tab to connect</li>
          </ol>
        </div>
        <a
          href="https://my.mollie.com/signup"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Sign up at Mollie
        </a>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        We&apos;ll create a Mollie account for you with your details pre-filled. You&apos;ll just need to set a password and approve the connection.
      </p>

      {formError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">{formError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Owner info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cl-givenName" className={labelCls}>First name *</label>
            <input
              id="cl-givenName"
              name="givenName"
              required
              defaultValue={partnerData?.firstName ?? ''}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="cl-familyName" className={labelCls}>Last name *</label>
            <input
              id="cl-familyName"
              name="familyName"
              required
              defaultValue={partnerData?.lastName ?? ''}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label htmlFor="cl-email" className={labelCls}>Email *</label>
          <input
            id="cl-email"
            name="email"
            type="email"
            required
            defaultValue={partnerData?.email ?? ''}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="cl-org" className={labelCls}>Organization / company name *</label>
          <input
            id="cl-org"
            name="organizationName"
            required
            defaultValue={partnerData?.company ?? ''}
            className={inputCls}
          />
        </div>

        {/* Address */}
        <div>
          <label htmlFor="cl-street" className={labelCls}>Street and number</label>
          <input
            id="cl-street"
            name="streetAndNumber"
            defaultValue={partnerData?.address ?? ''}
            placeholder="e.g. Keizersgracht 126"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="cl-postalCode" className={labelCls}>Postal code</label>
            <input
              id="cl-postalCode"
              name="postalCode"
              placeholder="1015 AA"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="cl-city" className={labelCls}>City</label>
            <input
              id="cl-city"
              name="city"
              placeholder="Amsterdam"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="cl-country" className={labelCls}>Country *</label>
            <select
              id="cl-country"
              name="country"
              required
              defaultValue="NL"
              className={inputCls}
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Optional business fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cl-reg" className={labelCls}>Registration number</label>
            <input
              id="cl-reg"
              name="registrationNumber"
              placeholder="Chamber of Commerce"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="cl-vat" className={labelCls}>VAT number</label>
            <input
              id="cl-vat"
              name="vatNumber"
              placeholder="NL123456789B01"
              className={inputCls}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          {submitting ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Creating account…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Create &amp; connect Mollie account
            </>
          )}
        </button>
      </form>
    </div>
  )
}
