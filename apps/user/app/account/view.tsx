'use client'

import { TextField } from '@repo/ui/TextField'
import { submitForm } from './actions'
import { useFormState, useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

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

export default function AccountView({ account } : { account: AccountProps }) {

  const [formState, formAction] = useFormState(submitForm, { status: '' })

  const t = useTranslations('Account')

  function SubmitButton() {
    const status = useFormStatus()
    return <button 
      disabled={status.pending}
      type="submit"
      className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none disabled:bg-blue-100 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center">
        {t('Save')}
    </button>
  }

  return (
    
    <div className="container mx-auto px-4 pt-[72px] h-screen">
      <div className="mx-auto max-w-[800px]">
      <div className="grid mb-6 md:grid-cols-1">
          {
            formState.status !== 'ok' ?
              (formState.errors || []).map((error) => (
                <div key={error} className="text-red-500">{ error }</div>
              )) :
              <div className="text-green-500">{t('Saved')}</div>
          }
        </div>
        <form action={formAction}>
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <TextField name="firstName" label={t('First name')} placeholder="John" value={account.firstName || ''} />
            <TextField name="lastName" label={t('Last name')} placeholder="Doe" value={account.lastName || ''} />
            <TextField name="email" label={t('E-mail')} placeholder="john.doe@company.com" value={account.email || ''} />
            <TextField name="phoneNumber" label={t('Phone number')} placeholder="123-45-678" value={account.phoneNumber || ''} />
          </div>
          <div className="grid gap-6 mb-6 md:grid-cols-1">
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}