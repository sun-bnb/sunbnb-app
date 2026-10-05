'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { track } from '@/lib/track.ts'

type Line = { role: 'assistant' | 'user' | 'note'; text: string }

/**
 * The AI sales chat beside the mockup (track 027 P5). Each page visit is a NEW session: earlier
 * conversations stay on the lead for the team but are never rendered here, because anyone holding
 * the mockup link can open this page and a transcript can contain contact details.
 *
 * The greeting is static copy, not a model call. Any failure degrades to a note pointing at the
 * demo form, which never depends on the chat.
 */
export default function ChatPanel({
  token,
  beachName,
  onSunbedCount,
}: {
  token: string
  beachName: string
  onSunbedCount: (n: number) => void
}) {
  const t = useTranslations('Chat')
  const inputId = useId()
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const [lines, setLines] = useState<Line[]>([{ role: 'assistant', text: t('greeting', { beach: beachName }) }])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [closed, setClosed] = useState(false)
  const [booked, setBooked] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines, pending])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const message = draft.trim()
    if (!message || pending || closed) return
    setDraft('')
    if (!lines.some((l) => l.role === 'user')) track('chat_open')
    setLines((l) => [...l, { role: 'user', text: message }])
    setPending(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, sessionId, message }),
      })
      const data = (await res.json().catch(() => ({ status: 'unavailable' }))) as {
        status: string
        reply?: string
        sunbedCount?: number
        demoRequested?: boolean
      }
      if (data.status === 'ok' && data.reply) {
        setLines((l) => [...l, { role: 'assistant', text: data.reply! }])
        if (typeof data.sunbedCount === 'number') onSunbedCount(data.sunbedCount)
        if (data.demoRequested && !booked) {
          setBooked(true)
          // Counted server-side in /api/chat; this only fires the ad pixel.
          track('demo_requested', { via: 'chat' }, { beacon: false })
        }
      } else if (data.status === 'rate_limited') {
        setLines((l) => [...l, { role: 'note', text: t('rateLimited') }])
      } else {
        setLines((l) => [...l, { role: 'note', text: data.status === 'limit' ? t('limit') : t('unavailable') }])
        setClosed(true)
      }
    } catch {
      setLines((l) => [...l, { role: 'note', text: t('unavailable') }])
      setClosed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="card flex h-[480px] flex-col p-0 shadow-sm" aria-labelledby={`${inputId}-title`}>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 id={`${inputId}-title`} className="text-sm font-semibold text-gray-900">
          {t('title')}
        </h2>
        {booked && <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            {t('demoBooked')}
          </span>}
      </div>

      <div ref={logRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {lines.map((line, i) =>
          line.role === 'note' ? (
            <p key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {line.text}
            </p>
          ) : (
            <div key={i} className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm ${
                  line.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {line.text}
              </p>
            </div>
          ),
        )}
        {pending && <p className="text-xs text-gray-400">{t('thinking')}</p>}
      </div>

      <form onSubmit={send} className="border-t border-gray-100 px-4 py-3">
        <div className="flex gap-2">
          <label htmlFor={inputId} className="sr-only">
            {t('placeholder')}
          </label>
          <input
            id={inputId}
            className="input"
            placeholder={t('placeholder')}
            value={draft}
            maxLength={1000}
            disabled={closed}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={pending || closed || !draft.trim()}>
            {t('send')}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-gray-400">
          {
            // next-intl's rich-text types resolve the hoisted @types/react 19; this app is on 18.
            t.rich('notice', {
              link: (chunks) => (
                <Link href="/privacy" target="_blank" className="underline hover:text-gray-600">
                  {chunks as React.ReactNode}
                </Link>
              ),
            }) as React.ReactNode
          }
        </p>
      </form>
    </section>
  )
}
