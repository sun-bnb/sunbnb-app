'use client'

import { TextField } from '@repo/ui/TextField'
import { submitForm } from './actions'
import { useFormState, useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'
import { signOut } from 'next-auth/react'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import LogoutIcon from '@mui/icons-material/Logout'

export interface AccountProps {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  company: string
  websiteUrl: string | null
  address: string 
  bankAccount: string | null
}

export default function AccountView({ account, userImage } : { account: AccountProps, userImage?: string | null }) {

  const [formState, formAction] = useFormState(submitForm, { status: '' })

  const t = useTranslations('Account')

  function SubmitButton() {
    const status = useFormStatus()
    return <button 
      disabled={status.pending}
      type="submit"
      className="w-full text-white bg-blue-600 hover:bg-blue-700 focus:ring-4 focus:outline-none disabled:bg-blue-200 font-medium rounded-xl text-sm px-5 py-3 text-center transition-colors">
        {status.pending ? '...' : t('Save')}
    </button>
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-md px-4 pt-[90px] pb-10">

        {/* Profile header */}
        <div className="flex flex-col items-center mb-8">
          {userImage ? (
            <img alt="" src={userImage} className="h-20 w-20 rounded-full ring-4 ring-white shadow-md mb-3" />
          ) : (
            <AccountCircleIcon sx={{ fontSize: 80 }} className="text-gray-300 mb-3" />
          )}
          <h1 className="text-xl font-semibold text-gray-800">
            {[account.firstName, account.lastName].filter(Boolean).join(' ') || t('Your Account')}
          </h1>
          <p className="text-sm text-gray-500">{account.email}</p>
        </div>

        {/* Status messages */}
        {formState.status === 'ok' ? (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700">
            {t('Saved')}
          </div>
        ) : (formState.errors || []).length > 0 && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600">
            {(formState.errors || []).map((e) => <div key={e}>{e}</div>)}
          </div>
        )}

        {/* Form */}
        <form action={formAction}>
          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <TextField name="firstName" label={t('First name')} placeholder="John" value={account.firstName || ''} />
              <TextField name="lastName" label={t('Last name')} placeholder="Doe" value={account.lastName || ''} />
            </div>
            <TextField name="email" label={t('E-mail')} placeholder="john.doe@company.com" value={account.email || ''} />
            <TextField name="phoneNumber" label={t('Phone number')} placeholder="123-45-678" value={account.phoneNumber || ''} />
          </div>
          <SubmitButton />
        </form>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <LogoutIcon sx={{ fontSize: 18 }} />
          Sign out
        </button>

      </div>
    </div>
  );
}