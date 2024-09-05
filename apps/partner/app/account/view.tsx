'use client'

import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import CheckIcon from '@mui/icons-material/Check'
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
                <Alert severity="error" sx={{ marginBottom: '2px' }}>{ error }</Alert>
              )) :
              <Alert icon={<CheckIcon fontSize="inherit" />} severity="success">
                Saved
              </Alert>
          }
        </div>
        <form action={formAction}>
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <TextField name="firstName" label="First name" placeholder="John" defaultValue={account.firstName || ''} />
            <TextField name="lastName" label="Last name" placeholder="Doe" defaultValue={account.lastName || ''} />
            <TextField name="email" label="E-mail" placeholder="john.doe@company.com" defaultValue={account.email || ''} />
            <TextField name="phoneNumber" label="Phone number" placeholder="123-45-678" defaultValue={account.phoneNumber || ''} />
            <TextField name="company" label="Company" placeholder="Flowbite" defaultValue={account.company || ''} />
            <TextField name="websiteUrl" label="Website URL" placeholder="flowbite.com" defaultValue={account.websiteUrl || ''} />
          </div>
          <div className="grid gap-6 mb-6 md:grid-cols-1">
            <TextField name="address" label="Address" placeholder="Sturenkatu 37-41 B 16, 00550 Helsinki, Finland" defaultValue={account.address || ''} />
            <TextField name="bankAccount" label="Bank account" placeholder="FI12 3456 7891 2345" defaultValue={account.bankAccount || ''} />
          </div>
          <div className="grid gap-6 mb-6 md:grid-cols-1">
            <Button type="submit" variant="contained">Save</Button>
          </div>
        </form>
      </div>
    </div>
  );
}