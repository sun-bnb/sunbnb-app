'use client'

import { TextField } from '@repo/ui/TextField'
import { submitForm } from './actions'
import { useFormState, useFormStatus } from 'react-dom'
import { SiteProps } from '@/app/sites/types'

export default function SiteEdit(site: SiteProps) {

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
      <div>Edit Site</div>
      <div>
        <form action={formAction}>
          <div>
            {
              site.id && (
                <div>
                  <div>Site ID: {site.id}</div>
                  <input type="hidden" name="id" value={site.id} />
                </div>
              )
            }
            
            <TextField name="name" label="Site name" value={site.name || ''} />
            <TextField name="locationLat" label="Latitude" value={site.locationLat || ''} />
            <TextField name="locationLng" label="Longitude" value={site.locationLng || ''} />
          </div>
          <div>
            <SubmitButton />
          </div>
        </form>
      </div>
      
    </div>
  )

}