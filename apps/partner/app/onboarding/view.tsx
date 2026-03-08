'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import { submitForm } from '@/app/account/actions'

/* ── Types ───────────────────────────────────────────────────────────────── */

interface AccountData {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  company: string
  businessId: string | null
  websiteUrl: string | null
  address: string
  bankAccount: string | null
}

interface PartnerData {
  firstName: string
  lastName: string
  email: string
  company: string
  address: string
}

interface OnboardingViewProps {
  defaultAccount: AccountData
  hasAccount: boolean
  mollieConnected: boolean
  mollieProfileId: string | null
  mollieOnboardingStatus: string | null
  partnerData: PartnerData | null
}

/* ── Field component ─────────────────────────────────────────────────────── */

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  type = 'text',
  required = false,
}: {
  name: string
  label: string
  placeholder?: string
  defaultValue?: string
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-gray-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-colors"
      />
    </div>
  )
}

/* ── Submit button ───────────────────────────────────────────────────────── */

function SubmitButton({ label = 'Continue' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
    >
      {pending ? (
        <>
          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Saving…
        </>
      ) : (
        label
      )}
    </button>
  )
}

/* ── Step indicator ──────────────────────────────────────────────────────── */

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { number: 1, label: 'Account details' },
    { number: 2, label: 'Connect payments' },
  ]

  return (
    <div className="flex items-center gap-3 mb-8">
      {steps.map((step, i) => (
        <div key={step.number} className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                step.number < currentStep
                  ? 'bg-emerald-100 text-emerald-700'
                  : step.number === currentStep
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {step.number < currentStep ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                step.number
              )}
            </div>
            <span
              className={`text-sm font-medium ${
                step.number <= currentStep ? 'text-gray-900' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-12 h-px ${step.number < currentStep ? 'bg-emerald-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Step 1: Account data ────────────────────────────────────────────────── */

function AccountStep({
  defaultAccount,
  onComplete,
}: {
  defaultAccount: AccountData
  onComplete: () => void
}) {
  const [formState, formAction] = useFormState(
    async (prev: { status: string; errors?: string[] }, formData: FormData) => {
      const result = await submitForm(prev, formData)
      if (result.status === 'ok') {
        onComplete()
      }
      return result
    },
    { status: '' }
  )

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Tell us about yourself</h2>
        <p className="text-sm text-gray-500 mt-1">
          We need these details to set up your partner account and prepare your payment onboarding.
        </p>
      </div>

      {formState.status === 'error' && formState.errors && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm font-medium text-red-800">Please fix the following:</p>
          </div>
          <ul className="ml-7 list-disc text-sm text-red-700 space-y-0.5">
            {formState.errors.map((error: string, i: number) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <form action={formAction}>
        {/* Personal info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Personal information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field name="firstName" label="First name" placeholder="John" defaultValue={defaultAccount.firstName || ''} required />
            <Field name="lastName" label="Last name" placeholder="Doe" defaultValue={defaultAccount.lastName || ''} required />
            <Field name="email" label="Email" type="email" placeholder="john@company.com" defaultValue={defaultAccount.email || ''} required />
            <Field name="phoneNumber" label="Phone number" type="tel" placeholder="+358 40 123 4567" defaultValue={defaultAccount.phoneNumber || ''} required />
          </div>
        </div>

        {/* Company info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Company</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field name="company" label="Company name" placeholder="Sunbnb Oy" defaultValue={defaultAccount.company || ''} required />
            <Field name="businessId" label="Business ID" placeholder="FI12345678" defaultValue={defaultAccount.businessId || ''} />
            <div className="md:col-span-2">
              <Field name="websiteUrl" label="Website" type="url" placeholder="https://sunbnb.com" defaultValue={defaultAccount.websiteUrl || ''} />
            </div>
            <div className="md:col-span-2">
              <Field name="address" label="Address" placeholder="Sturenkatu 37-41 B 16, 00550 Helsinki, Finland" defaultValue={defaultAccount.address || ''} required />
            </div>
          </div>
        </div>

        {/* Billing */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Billing</h3>
          <div className="grid grid-cols-1 gap-4">
            <Field name="bankAccount" label="Bank account (IBAN)" placeholder="FI12 3456 7891 2345" defaultValue={defaultAccount.bankAccount || ''} />
          </div>
        </div>

        <div className="flex justify-end">
          <SubmitButton label="Save & continue" />
        </div>
      </form>
    </>
  )
}

/* ── Step 2: Mollie connect ──────────────────────────────────────────────── */

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

function MollieStep({ partnerData }: { partnerData: PartnerData | null }) {
  const router = useRouter()
  const [tab, setTab] = useState<'existing' | 'new'>('existing')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const inputCls =
    'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  const handleClientLink = async (e: React.FormEvent<HTMLFormElement>) => {
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

      window.location.href = data.url
    } catch {
      setFormError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Connect payments</h2>
        <p className="text-sm text-gray-500 mt-1">
          Connect your Mollie account to accept payments from customers. You can also do this later from your account settings.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
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
        ) : unavailable ? (
          <div>
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800 mb-2">
                Automatic account creation is not yet available. You can create a Mollie account manually and then connect it.
              </p>
              <ol className="text-sm text-amber-800 list-decimal list-inside space-y-1">
                <li>Create an account at <a href="https://my.mollie.com/signup" target="_blank" rel="noopener noreferrer" className="font-medium underline">my.mollie.com</a></li>
                <li>Switch to the <button onClick={() => { setTab('existing'); setUnavailable(false) }} className="font-medium underline">&ldquo;I have a Mollie account&rdquo;</button> tab to connect</li>
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
        ) : (
          <div>
            <p className="text-xs text-gray-500 mb-4">
              We&apos;ll create a Mollie account for you with your details pre-filled.
              You&apos;ll just need to set a password and approve the connection.
            </p>

            {formError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">{formError}</p>
              </div>
            )}

            <form onSubmit={handleClientLink} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ob-givenName" className={labelCls}>First name *</label>
                  <input id="ob-givenName" name="givenName" required defaultValue={partnerData?.firstName ?? ''} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="ob-familyName" className={labelCls}>Last name *</label>
                  <input id="ob-familyName" name="familyName" required defaultValue={partnerData?.lastName ?? ''} className={inputCls} />
                </div>
              </div>

              <div>
                <label htmlFor="ob-email" className={labelCls}>Email *</label>
                <input id="ob-email" name="email" type="email" required defaultValue={partnerData?.email ?? ''} className={inputCls} />
              </div>

              <div>
                <label htmlFor="ob-org" className={labelCls}>Organization / company name *</label>
                <input id="ob-org" name="organizationName" required defaultValue={partnerData?.company ?? ''} className={inputCls} />
              </div>

              <div>
                <label htmlFor="ob-street" className={labelCls}>Street and number</label>
                <input id="ob-street" name="streetAndNumber" defaultValue={partnerData?.address ?? ''} placeholder="e.g. Keizersgracht 126" className={inputCls} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ob-postalCode" className={labelCls}>Postal code</label>
                  <input id="ob-postalCode" name="postalCode" placeholder="1015 AA" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="ob-city" className={labelCls}>City</label>
                  <input id="ob-city" name="city" placeholder="Amsterdam" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="ob-country" className={labelCls}>Country *</label>
                  <select id="ob-country" name="country" required defaultValue="NL" className={inputCls}>
                    {COUNTRY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ob-reg" className={labelCls}>Registration number</label>
                  <input id="ob-reg" name="registrationNumber" placeholder="Chamber of Commerce" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="ob-vat" className={labelCls}>VAT number</label>
                  <input id="ob-vat" name="vatNumber" placeholder="NL123456789B01" className={inputCls} />
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
        )}
      </div>

      {/* Do this later */}
      <div className="flex justify-between items-center">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Do this later
        </button>
        <p className="text-xs text-gray-400">
          You can connect Mollie anytime from Account &rarr; Mollie Payments
        </p>
      </div>
    </>
  )
}

/* ── Main onboarding view ────────────────────────────────────────────────── */

export default function OnboardingView({
  defaultAccount,
  hasAccount,
  mollieConnected,
  partnerData,
}: OnboardingViewProps) {
  const [step, setStep] = useState(hasAccount ? 2 : 1)

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Header */}
        <div className="mb-2">
          <h1 className="text-xl font-bold text-gray-900">Welcome to SunBnB</h1>
          <p className="text-sm text-gray-500 mt-1">
            Let&apos;s get your partner account set up in a few quick steps.
          </p>
        </div>

        <StepIndicator currentStep={step} />

        {step === 1 ? (
          <AccountStep
            defaultAccount={defaultAccount}
            onComplete={() => setStep(2)}
          />
        ) : (
          <MollieStep partnerData={partnerData} />
        )}
      </div>
    </div>
  )
}
