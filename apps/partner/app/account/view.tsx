'use client'

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
  bankAccount: string | null
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

/* ── Main view ─────────────────────────────────────────────── */

export default function AccountView({ account }: { account: AccountProps }) {

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
            <Field name="businessId" label="Business ID" placeholder="FI12345678" defaultValue={account.businessId || ''} />
            <div className="md:col-span-2">
              <Field name="websiteUrl" label="Website" type="url" placeholder="https://sunbnb.com" defaultValue={account.websiteUrl || ''} />
            </div>
            <div className="md:col-span-2">
              <Field name="address" label="Address" placeholder="Sturenkatu 37-41 B 16, 00550 Helsinki, Finland" defaultValue={account.address || ''} required />
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
