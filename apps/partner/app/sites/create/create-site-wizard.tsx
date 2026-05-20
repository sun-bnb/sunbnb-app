'use client'

import React, { useState } from 'react'
import Stepper from '@mui/material/Stepper'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Button from '@mui/material/Button'
import StepLocation from './step-location'
import StepDetails from './step-details'
import StepContent from './step-content'
import StepDone from './step-done'

const STEPS = ['Location', 'Details', 'Content', 'Done']

export interface WizardFeeData {
  chargeType: string
  feeAmount?: number | null
  percentage?: number | null
  serviceCode: string
  overridden?: boolean
}

export interface WizardData {
  // Step 1 — location
  name: string
  locationLat: string
  locationLng: string
  // Step 2 — details
  type: string
  price: string
  vat: string
  workingHours: { day: string; openTime: string; closeTime: string }[]
  // Step 3 — content
  description: string
  services: string[]
  imageFile: File | null
  // Result
  siteId: string | null
}

const initialData: WizardData = {
  name: '',
  locationLat: '',
  locationLng: '',
  type: 'paid',
  price: '',
  vat: '',
  workingHours: [],
  description: '',
  services: [],
  imageFile: null,
  siteId: null,
}

export default function CreateSiteWizard({
  apiKey,
  tier,
  serviceFee,
  allowed = true,
  features = null,
}: {
  apiKey: string
  tier: string
  serviceFee?: WizardFeeData | null
  allowed?: boolean
  features?: Record<string, boolean> | null
}) {

  const [activeStep, setActiveStep] = useState(0)
  const [data, setData] = useState<WizardData>(initialData)
  const [errors, setErrors] = useState<string[]>([])

  const update = (partial: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...partial }))
  }

  const canNext = (): boolean => {
    if (activeStep === 0) {
      return !!(data.locationLat && data.locationLng)
    }
    if (activeStep === 1) {
      if (!data.name.trim()) return false
      if (data.type === 'paid' && !data.vat.trim()) return false
      return true
    }
    return true
  }

  const handleNext = () => {
    setErrors([])
    if (!canNext()) {
      if (activeStep === 0) {
        setErrors(['Click the map to set the site location'])
      } else if (activeStep === 1) {
        setErrors(['Site name is required'])
      }
      return
    }
    setActiveStep(prev => prev + 1)
  }

  const handleBack = () => {
    setErrors([])
    setActiveStep(prev => prev - 1)
  }

  const isLastContentStep = activeStep === 2
  const isDone = activeStep === 3

  // Show limit-reached guard only when the user hasn't just finished creating a site
  if (!allowed && !data.siteId) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <p className="text-gray-700 font-medium mb-2">Site limit reached</p>
        <p className="text-sm text-gray-500 mb-4">
          Your current plan does not allow creating more sites. Upgrade your plan to add more.
        </p>
        <a href="/sites" className="text-sm text-blue-600 underline">Back to sites</a>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
        {STEPS.map(label => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {errors.length > 0 && (
        <div className="mb-4">
          {errors.map(e => (
            <div key={e} className="text-red-500 text-center text-sm">{e}</div>
          ))}
        </div>
      )}

      {activeStep === 0 && (
        <StepLocation data={data} update={update} apiKey={apiKey} />
      )}
      {activeStep === 1 && (
        <StepDetails
          data={data}
          update={update}
          tier={tier}
          serviceFee={serviceFee}
          features={features}
        />
      )}
      {activeStep === 2 && (
        <StepContent data={data} update={update} />
      )}
      {activeStep === 3 && (
        <StepDone data={data} />
      )}

      {/* Navigation */}
      {!isDone && (
        <div className="flex justify-between mt-6">
          <Button
            disabled={activeStep === 0}
            onClick={handleBack}
            variant="outlined"
            sx={{ textTransform: 'none' }}
          >
            Back
          </Button>
          {isLastContentStep ? (
            <CreateButton data={data} update={update} setErrors={setErrors} onDone={() => setActiveStep(3)} />
          ) : (
            <Button
              onClick={handleNext}
              variant="contained"
              disabled={!canNext()}
              sx={{ textTransform: 'none' }}
            >
              Next
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Separate component so we can use useFormStatus-style patterns if needed */
function CreateButton({
  data,
  update,
  setErrors,
  onDone,
}: {
  data: WizardData
  update: (p: Partial<WizardData>) => void
  setErrors: (e: string[]) => void
  onDone: () => void
}) {

  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    setSaving(true)
    setErrors([])
    try {
      const { createSite, uploadSiteImage } = await import('./actions')
      const { imageFile, siteId: _sid, ...plainData } = data
      const result = await createSite(plainData)
      if (result.status === 'error') {
        setErrors(result.errors || ['Something went wrong'])
        setSaving(false)
        return
      }

      // Upload image if one was selected
      if (data.imageFile && result.siteId) {
        const fd = new FormData()
        fd.append('image', data.imageFile)
        await uploadSiteImage(result.siteId, fd)
      }

      update({ siteId: result.siteId || null })
      onDone()
    } catch (e) {
      console.error(e)
      setErrors(['An unexpected error occurred'])
      setSaving(false)
    }
  }

  return (
    <Button
      onClick={handleCreate}
      variant="contained"
      disabled={saving}
      sx={{ textTransform: 'none' }}
    >
      {saving ? 'Creating…' : 'Create Site'}
    </Button>
  )
}
