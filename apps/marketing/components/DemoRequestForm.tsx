'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useId, useMemo, useState, useTransition } from 'react'
import { requestDemo } from '@/app/actions'
import { HONEYPOT_FIELD, parseDemoRequest, type DemoRequestError } from '@/lib/demo-request.ts'
import { track } from '@/lib/track.ts'

const ERROR_KEYS: Record<DemoRequestError | 'rateLimited' | 'notFound', string> = {
  name: 'errName',
  contact: 'errContact',
  email: 'errEmail',
  phone: 'errPhone',
  consent: 'errConsent',
  tooLong: 'errTooLong',
  rateLimited: 'errRateLimited',
  notFound: 'errGeneric',
}

/**
 * "Request a demo" — the only place personal data enters the lead (track 027 P3). Consent is a
 * required, unticked checkbox linked to the versioned privacy notice.
 */
export default function DemoRequestForm({ token, beachName }: { token: string; beachName: string }) {
  const t = useTranslations('Demo')
  const ids = { name: useId(), email: useId(), phone: useId(), business: useId(), message: useId(), consent: useId() }
  const renderedAt = useMemo(() => String(Date.now()), [])
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const local = parseDemoRequest(data)
    if (!local.ok) return setErrors(local.errors.map((k) => ERROR_KEYS[k]))
    start(async () => {
      const res = await requestDemo(token, data).catch(() => ({ status: 'error' as const, errors: ['notFound' as const] }))
      if (res.status === 'ok') {
        // Counted server-side in requestDemo; this only fires the ad pixel.
        track('demo_requested', { via: 'form' }, { beacon: false })
        return setDone(true)
      }
      setErrors(res.errors.map((k) => ERROR_KEYS[k] ?? 'errGeneric'))
    })
  }

  if (done) {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="text-sm font-semibold text-green-700">{t('thanks')}</p>
        <p className="mt-1 text-sm text-green-700">{t('thanksBody')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card space-y-4 p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('subtitle', { beach: beachName })}</p>
      </div>

      {/* Honeypot: invisible to people (and to assistive tech), irresistible to form-filling bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name="rendered_at" value={renderedAt} />

      <div>
        <label htmlFor={ids.name} className="label">{t('name')}</label>
        <input id={ids.name} name="name" className="input" autoComplete="name" required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.email} className="label">{t('email')}</label>
          <input id={ids.email} name="email" type="email" className="input" autoComplete="email" />
        </div>
        <div>
          <label htmlFor={ids.phone} className="label">{t('phone')}</label>
          <input id={ids.phone} name="phone" type="tel" className="input" autoComplete="tel" />
        </div>
      </div>
      <p className="-mt-2 text-xs text-gray-500">{t('contactHint')}</p>
      <div>
        <label htmlFor={ids.business} className="label">{t('business')}</label>
        <input id={ids.business} name="business" className="input" autoComplete="organization" />
      </div>
      <div>
        <label htmlFor={ids.message} className="label">{t('message')}</label>
        <textarea id={ids.message} name="message" rows={3} maxLength={2000} className="input" />
      </div>
      <div className="flex items-start gap-2">
        <input id={ids.consent} name="consent" type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300" />
        <label htmlFor={ids.consent} className="text-xs text-gray-600">
          {
            // next-intl's rich-text types resolve the hoisted @types/react 19; this app is on 18.
            t.rich('consent', {
              link: (chunks) => (
                <Link href="/privacy" target="_blank" className="underline hover:text-gray-900">
                  {chunks as React.ReactNode}
                </Link>
              ),
            }) as React.ReactNode
          }
        </label>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {[...new Set(errors)].map((k) => (
            <p key={k}>{t(k)}</p>
          ))}
        </div>
      )}

      <button type="submit" className="btn-primary-lg w-full" disabled={pending}>
        {pending ? t('sending') : t('submit')}
      </button>
    </form>
  )
}
