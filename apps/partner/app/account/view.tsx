'use client'

import Link from 'next/link'
import { submitForm } from './actions'
import { useFormState, useFormStatus } from 'react-dom'

export interface AccountProps {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  company: string
  businessId: string | null
  websiteUrl: string | null
  address: string
  city: string | null
  postalCode: string | null
  country: string | null
  bankAccount: string | null
}

export interface MollieStatus {
  isConnected: boolean
  onboardingStatus: string | null
}

/* ── Input component ───────────────────────────────────────── */

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

/* ── Select field component ────────────────────────────────── */

const COUNTRY_OPTIONS = [
  { code: 'AT', label: 'Austria' }, { code: 'BE', label: 'Belgium' },
  { code: 'HR', label: 'Croatia' }, { code: 'CY', label: 'Cyprus' },
  { code: 'CZ', label: 'Czech Republic' }, { code: 'DK', label: 'Denmark' },
  { code: 'EE', label: 'Estonia' }, { code: 'FI', label: 'Finland' },
  { code: 'FR', label: 'France' }, { code: 'DE', label: 'Germany' },
  { code: 'GR', label: 'Greece' }, { code: 'HU', label: 'Hungary' },
  { code: 'IT', label: 'Italy' }, { code: 'LV', label: 'Latvia' },
  { code: 'LT', label: 'Lithuania' }, { code: 'LU', label: 'Luxembourg' },
  { code: 'MT', label: 'Malta' }, { code: 'NL', label: 'Netherlands' },
  { code: 'NO', label: 'Norway' }, { code: 'PL', label: 'Poland' },
  { code: 'PT', label: 'Portugal' }, { code: 'RO', label: 'Romania' },
  { code: 'SK', label: 'Slovakia' }, { code: 'SI', label: 'Slovenia' },
  { code: 'ES', label: 'Spain' }, { code: 'SE', label: 'Sweden' },
  { code: 'CH', label: 'Switzerland' }, { code: 'GB', label: 'United Kingdom' },
]

function SelectField({
  name, label, defaultValue, required = false,
  options,
}: {
  name: string; label: string; defaultValue?: string; required?: boolean
  options: { code: string; label: string }[]
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-gray-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ''}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-colors"
      >
        <option value="">Select country…</option>
        {options.map(o => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ── Submit button ─────────────────────────────────────────── */

function SubmitButton() {
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
        'Save changes'
      )}
    </button>
  )
}

/* ── Mollie status card ────────────────────────────────────── */

function MollieStatusCard({ mollieStatus }: { mollieStatus: MollieStatus }) {
  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    'completed':  { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Verified' },
    'in-review':  { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'In review' },
    'needs-data': { bg: 'bg-orange-50',  text: 'text-orange-700',  label: 'Needs data' },
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Mollie Payments</h2>
        <Link
          href="/account/mollie"
          className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          Manage &rarr;
        </Link>
      </div>

      <div className="flex items-center gap-3">
        {mollieStatus.isConnected ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Connected
            </span>
            {mollieStatus.onboardingStatus && (() => {
              const cfg = statusConfig[mollieStatus.onboardingStatus] ?? { bg: 'bg-gray-50', text: 'text-gray-600', label: mollieStatus.onboardingStatus }
              return (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                  {cfg.label}
                </span>
              )
            })()}
          </>
        ) : (
          <div className="flex items-center justify-between w-full">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              Not connected
            </span>
            <Link
              href="/account/mollie"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Connect Mollie
            </Link>
          </div>
        )}
      </div>

      {mollieStatus.isConnected && mollieStatus.onboardingStatus === 'needs-data' && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">
          Your Mollie account requires additional information.{' '}
          <a href="https://my.mollie.com/dashboard" target="_blank" rel="noopener noreferrer" className="font-medium underline">
            Complete onboarding at Mollie
          </a>
        </p>
      )}
    </div>
  )
}

/* ── Main view ─────────────────────────────────────────────── */

export default function AccountView({ account, mollieStatus }: { account: AccountProps; mollieStatus: MollieStatus }) {

  const [formState, formAction] = useFormState(submitForm, { status: '' })

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Account</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your partner account details</p>
      </div>

      {/* Status banners */}
      {formState.status === 'ok' && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-sm text-emerald-800">Account details saved successfully</p>
        </div>
      )}

      {formState.status === 'error' && formState.errors && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm font-medium text-red-800">Please fix the following:</p>
          </div>
          <ul className="ml-7 list-disc text-sm text-red-700 space-y-0.5">
            {formState.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Mollie payment status */}
      <MollieStatusCard mollieStatus={mollieStatus} />

      <form action={formAction}>

        {/* Personal info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Personal information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field name="firstName" label="First name" placeholder="John" defaultValue={account.firstName || ''} required />
            <Field name="lastName" label="Last name" placeholder="Doe" defaultValue={account.lastName || ''} required />
            <Field name="email" label="Email" type="email" placeholder="john@company.com" defaultValue={account.email || ''} required />
            <Field name="phoneNumber" label="Phone number" type="tel" placeholder="+358 40 123 4567" defaultValue={account.phoneNumber || ''} required />
          </div>
        </div>

        {/* Company info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Company</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field name="company" label="Company name" placeholder="Sunbnb Oy" defaultValue={account.company || ''} required />
            <Field name="businessId" label="Business ID" placeholder="FI12345678" defaultValue={account.businessId || ''} required />
            <div className="md:col-span-2">
              <Field name="websiteUrl" label="Website" type="url" placeholder="https://sunbnb.com" defaultValue={account.websiteUrl || ''} />
            </div>
            <div className="md:col-span-2">
              <Field name="address" label="Street address" placeholder="Paseo Marítimo 12" defaultValue={account.address || ''} required />
            </div>
            <Field name="postalCode" label="Postal code" placeholder="29602" defaultValue={account.postalCode || ''} required />
            <Field name="city" label="City" placeholder="Marbella" defaultValue={account.city || ''} required />
            <div className="md:col-span-2">
              <SelectField name="country" label="Country" defaultValue={account.country || ''} required options={COUNTRY_OPTIONS} />
            </div>
          </div>
        </div>

        {/* Billing */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Billing</h2>
          <div className="grid grid-cols-1 gap-4">
            <Field name="bankAccount" label="Bank account (IBAN)" placeholder="FI12 3456 7891 2345" defaultValue={account.bankAccount || ''} />
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <SubmitButton />
        </div>

      </form>
    </div>
  )
}
