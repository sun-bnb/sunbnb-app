'use client'

import { useState } from 'react'
import { grantVerifactuAuthorisations } from './actions'

interface Props {
  company: string
  businessId: string | null
  isSpanish: boolean
  regime: string
  state: 'none' | 'invoicing-only' | 'complete'
  invoicingGrantedAt: string | null
  submissionGrantedAt: string | null
  termsVersion: string | null
}

export default function VerifactuAuthorisationView(props: Props) {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [checked, setChecked] = useState(false)
  const granted = props.state === 'complete'

  async function handleGrant() {
    setSaving(true)
    setErrors([])
    try {
      const res = await grantVerifactuAuthorisations()
      if (res.status !== 'ok') setErrors(res.errors ?? ['Could not save'])
    } catch {
      setErrors(['Could not save'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 text-sm text-gray-700 leading-relaxed">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Veri*factu authorisation</h1>
      <p className="text-xs text-gray-400 mb-8">{props.company}</p>

      {!props.isSpanish && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
          <p>
            Veri*factu applies to businesses established in Spain. Your account is not
            registered in Spain, so there is nothing to authorise here.
          </p>
        </div>
      )}

      {props.isSpanish && (
        <>
          {granted ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 mb-6">
              <p className="font-medium text-green-900">Authorisation on file.</p>
              <p className="text-green-800 mt-1 text-xs">
                Invoicing authority granted{' '}
                {props.invoicingGrantedAt?.slice(0, 10) ?? '—'} · AEAT submission granted{' '}
                {props.submissionGrantedAt?.slice(0, 10) ?? '—'}
                {props.termsVersion ? ` · terms ${props.termsVersion}` : ''}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
              <p className="font-medium text-amber-900">Authorisation needed.</p>
              <p className="text-amber-800 mt-1 text-xs">
                Until you authorise us, your fiscal records are generated and held, but not
                sent to the Agencia Tributaria.
              </p>
            </div>
          )}

          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">What you are authorising</h2>
            <p>
              Your business is the <strong>Seller of Record</strong> for everything sold through
              Sunbnb at your venue, so Spanish invoicing obligations fall on you. Sunbnb carries
              them out on your behalf. Two separate permissions are needed for that:
            </p>
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="font-medium text-gray-900">
                  1. Issuing invoices in your name
                </p>
                <p className="text-gray-600 mt-1">
                  Sunbnb expedites the invoice or simplified receipt for each sale, in your name
                  and on your behalf, under article 5 of Royal Decree 1619/2012. Each record
                  states that it was issued by a third party and identifies Sunbnb as that third
                  party.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="font-medium text-gray-900">
                  2. Sending your records to the Agencia Tributaria
                </p>
                <p className="text-gray-600 mt-1">
                  Sunbnb transmits the resulting billing records to AEAT on your behalf, acting
                  as a <em>colaborador social</em>. Without this, AEAT refuses the submission and
                  your records cannot be filed.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">What this does not do</h2>
            <ul className="list-disc list-inside text-gray-600 space-y-1.5">
              <li>
                It does not give Sunbnb your electronic certificate, or ask you to obtain one.
                We file using our own.
              </li>
              <li>
                It does not authorise Sunbnb to act for you in any other dealing with the
                Agencia Tributaria, or anywhere else.
              </li>
              <li>
                It does not move your tax liability. You remain responsible for the invoicing
                issued in your name.
              </li>
              <li>You can withdraw it by contacting us.</li>
            </ul>
          </section>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 mb-4">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-700">
                  {e}
                </p>
              ))}
            </div>
          )}

          {!granted && (
            <div className="border-t border-gray-200 pt-5">
              <label className="flex items-start gap-3 mb-4">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-gray-800">
                  On behalf of <strong>{props.company}</strong>
                  {props.businessId ? ` (${props.businessId})` : ''}, I authorise Sunbnb España
                  SL to issue invoices in our name and to submit the corresponding billing
                  records to the Agencia Tributaria on our behalf.
                </span>
              </label>
              <button
                type="button"
                onClick={handleGrant}
                disabled={!checked || saving}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Authorise'}
              </button>
              <p className="text-xs text-gray-400 mt-3">
                We record who accepted, when, and from where, as evidence of the mandate.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
