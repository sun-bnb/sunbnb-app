'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

export interface BookingFormLabels {
  heading: string
  guestName: string
  guestEmail: string
  guestPhone: string
  specialRequests: string
  submit: string
  submitting: string
  errorPrefix: string
}

export interface BookingFormValues {
  guestName: string
  guestEmail: string
  guestPhone: string
  specialRequests: string
}

export interface BookingFormProps {
  labels: BookingFormLabels
  initial?: Partial<BookingFormValues>
  onSubmit: (values: BookingFormValues) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

export function BookingForm({ labels, initial, onSubmit }: BookingFormProps) {
  const [guestName, setGuestName] = useState(initial?.guestName ?? '')
  const [guestEmail, setGuestEmail] = useState(initial?.guestEmail ?? '')
  const [guestPhone, setGuestPhone] = useState(initial?.guestPhone ?? '')
  const [specialRequests, setSpecialRequests] = useState(initial?.specialRequests ?? '')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    const res = await onSubmit({ guestName, guestEmail, guestPhone, specialRequests })
    setBusy(false)
    if (res.status === 'error') setErrors(res.errors ?? [])
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-gray-900">{labels.heading}</h3>
      <TextField
        size="small"
        label={labels.guestName}
        value={guestName}
        onChange={(e) => setGuestName(e.target.value)}
        required
        fullWidth
      />
      <TextField
        size="small"
        label={labels.guestEmail}
        type="email"
        value={guestEmail}
        onChange={(e) => setGuestEmail(e.target.value)}
        required
        fullWidth
      />
      <TextField
        size="small"
        label={labels.guestPhone}
        type="tel"
        value={guestPhone}
        onChange={(e) => setGuestPhone(e.target.value)}
        fullWidth
      />
      <TextField
        size="small"
        label={labels.specialRequests}
        value={specialRequests}
        onChange={(e) => setSpecialRequests(e.target.value)}
        multiline
        minRows={2}
        fullWidth
      />
      {errors.length > 0 && (
        <div className="text-xs text-red-600">
          {labels.errorPrefix}: {errors.join(', ')}
        </div>
      )}
      <Button
        type="submit"
        variant="contained"
        size="small"
        disabled={busy}
        sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
      >
        {busy ? labels.submitting : labels.submit}
      </Button>
    </form>
  )
}
