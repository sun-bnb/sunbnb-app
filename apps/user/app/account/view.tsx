'use client'

import { TextField } from '@repo/ui/TextField'
import { submitForm } from './actions'
import { useFormState, useFormStatus } from 'react-dom'

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

  function SubmitButton() {
    const status = useFormStatus()
    return <button 
      disabled={status.pending}
      type="submit"
      className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none disabled:bg-blue-100 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center">
        Save
    </button>
  }

  return (
    
    <div className="container mx-auto px-4">
      <div className="mx-auto max-w-[800px]">
      <div className="grid mb-6 md:grid-cols-1">
          {
            formState.status !== 'ok' ?
              (formState.errors || []).map((error) => (
                <div key={error} className="text-red-500">{ error }</div>
              )) :
              <div className="text-green-500">Saved</div>
          }
        </div>
        <form action={formAction}>
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <TextField name="firstName" label="First name" placeholder="John" value={account.firstName || ''} />
            <TextField name="lastName" label="Last name" placeholder="Doe" value={account.lastName || ''} />
            <TextField name="email" label="E-mail" placeholder="john.doe@company.com" value={account.email || ''} />
            <TextField name="phoneNumber" label="Phone number" placeholder="123-45-678" value={account.phoneNumber || ''} />
            <TextField name="company" label="Company" placeholder="Flowbite" value={account.company || ''} />
            <TextField name="websiteUrl" label="Website URL" placeholder="flowbite.com" value={account.websiteUrl || ''} />
          </div>
          <div className="grid gap-6 mb-6 md:grid-cols-1">
            <TextField name="address" label="Address" placeholder="Sturenkatu 37-41 B 16, 00550 Helsinki, Finland" value={account.address || ''} />
            <TextField name="bankAccount" label="Bank account" placeholder="FI12 3456 7891 2345" value={account.bankAccount || ''} />
          </div>
          <div className="grid gap-6 mb-6 md:grid-cols-1">
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}