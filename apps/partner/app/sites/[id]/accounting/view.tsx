'use client'

import Link from 'next/link'

import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { updateVat } from '../actions'
import { SiteProps } from '@/types/shared'
import { useSite } from '@/app/sites/site-context'

export default function Accounting() {
  
  const [ formState, formAction ] = useFormState(updateVat, { status: '' })
  const { site } = useSite()

  return (
    <div className="container mx-auto">
      <div className="mt-6 flex w-full">
        <form action={formAction} className="w-full">
          <input type="hidden" name="id" value={site.id} />
          <div className="mt-4 flex-1">
            <TextField
              name="vat"
              label="VAT"
              fullWidth={true}
              multiline
              defaultValue={site.vat || ''}
              variant="standard"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" variant="contained">Save</Button>
          </div>
        </form>
      </div>
    </div>
  )

}