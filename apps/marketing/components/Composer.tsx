'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { haptic } from '@/lib/app-sprites.ts'
import { looksLikeQuestion, parseIntent, type Intent } from '@/lib/intent.ts'
import { track } from '@/lib/track.ts'

export interface BeachSuggestion {
  placeId: string
  main: string
  secondary: string
}

const DEBOUNCE_MS = 220
/** "Show me an example" — a real beach, so the whole journey (shore snap included) works. */
export const EXAMPLE_QUERY = 'Platja de Muro, Mallorca'
export const EXAMPLE_COUNT = 60

/**
 * Places search behind the one bar (track 027 D11). Owned by the shell so the thread's chips
 * ("Near me", "Show me an example") and the agent (`find_beach`) can drive the same search the
 * visitor types into. Suggestions are only fetched while the beach is being chosen, and never for
 * text that reads as a question — that goes to the agent.
 */
export function useBeachSearch({ enabled, onSay }: { enabled: boolean; onSay: (key: string) => void }) {
  const locale = useLocale()
  const session = useMemo(() => crypto.randomUUID(), [])
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<BeachSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [near, setNear] = useState<string | null>(null)
  const seqRef = useRef(0)
  const intent = useMemo(() => parseIntent(text), [text])

  const lookup = useCallback(
    async (query: string, bias: string | null) => {
      const seq = ++seqRef.current
      setLoading(true)
      try {
        const params = new URLSearchParams({ input: query, session, lang: locale })
        if (bias) params.set('near', bias)
        const res = await fetch(`/api/places/autocomplete?${params}`)
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { suggestions: BeachSuggestion[] }
        if (seq !== seqRef.current) return null // a newer keystroke won
        setSuggestions(data.suggestions)
        setActive(0)
        setOpen(true)
        return data.suggestions
      } catch {
        if (seq === seqRef.current) onSay('searchDown')
        return null
      } finally {
        if (seq === seqRef.current) setLoading(false)
      }
    },
    [session, locale, onSay],
  )

  useEffect(() => {
    if (!enabled || intent.query.length < 2 || looksLikeQuestion(text)) {
      if (!near) setSuggestions([])
      return
    }
    const timer = setTimeout(() => void lookup(intent.query, near), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [enabled, intent.query, near])

  const nearMe = useCallback(
    (nearQuery: string) => {
      track('search_start')
      if (!navigator.geolocation) return onSay('noLocation')
      onSay('locating')
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const bias = `${pos.coords.latitude.toFixed(2)},${pos.coords.longitude.toFixed(2)}`
          setNear(bias)
          const found = await lookup(nearQuery, bias)
          if (found) onSay(found.length ? 'nearFound' : 'noMatch')
        },
        () => onSay('noLocation'),
        { timeout: 8000, maximumAge: 300_000 },
      )
    },
    [lookup, onSay],
  )

  /** Put a query in the bar and show its matches — for the agent's `find_beach` and the example chip. */
  const find = useCallback(
    async (query: string) => {
      setNear(null)
      setText(query)
      return lookup(query, null)
    },
    [lookup],
  )

  return { session, text, setText, suggestions, open, setOpen, active, setActive, loading, intent, nearMe, find, setNear }
}

export type BeachSearch = ReturnType<typeof useBeachSearch>

/**
 * The ONE input of the whole experience: beach search on the first screen, then the visitor's
 * voice in the thread at every later step. What a submit means is the shell's decision
 * (`onSubmit`); this component only types, suggests and sends.
 */
export default function Composer({
  search,
  searching,
  placeholder,
  busy,
  onSubmit,
  onPick,
}: {
  search: BeachSearch
  /** True while the beach is being chosen: suggestions open above the bar. */
  searching: boolean
  placeholder: string
  busy: boolean
  onSubmit: (text: string) => void
  onPick: (s: BeachSuggestion, intent: Intent) => void
}) {
  const t = useTranslations('Thread')
  const ids = { input: useId(), list: useId() }
  const { text, setText, suggestions, open, setOpen, active, setActive, loading, intent, setNear } = search
  const showList = searching && open && suggestions.length > 0

  function choose(s: BeachSuggestion) {
    haptic(12)
    track('beach_pick')
    setOpen(false)
    setText('')
    onPick(s, intent)
  }

  function submit() {
    const value = text.trim()
    if (searching && showList && !looksLikeQuestion(value) && suggestions[active]) return choose(suggestions[active]!)
    if (!value) return
    haptic(6)
    setText('')
    onSubmit(value)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      return submit()
    }
    if (!showList) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      {showList && (
        <ul id={ids.list} role="listbox" className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-[40svh] overflow-auto rounded-2xl border border-[#0e3a4a]/10 bg-white/95 py-2 shadow-2xl backdrop-blur">
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${ids.list}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${i === active ? 'bg-[#00cef1]/10' : ''}`}
            >
              <svg className="h-5 w-5 shrink-0 text-[#00a9c7]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
              </svg>
              <span className="min-w-0">
                <span className="block truncate text-base font-medium text-[#0e3a4a]">{s.main}</span>
                {s.secondary && <span className="block truncate text-sm text-[#0e3a4a]/60">{s.secondary}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor={ids.input} className="sr-only">
        {placeholder}
      </label>
      <div className="flex items-center gap-2 rounded-2xl border-2 border-[#0e3a4a] bg-white py-1.5 pl-4 pr-1.5 shadow-[0_5px_0_#0e3a4a] transition-transform focus-within:translate-y-[2px] focus-within:shadow-[0_3px_0_#0e3a4a]">
        <input
          id={ids.input}
          role={searching ? 'combobox' : undefined}
          aria-autocomplete={searching ? 'list' : undefined}
          aria-expanded={searching ? showList : undefined}
          aria-controls={searching ? ids.list : undefined}
          aria-activedescendant={showList ? `${ids.list}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            if (!text && searching) track('search_start')
            setText(e.target.value)
            setNear(null)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-[#0e3a4a] placeholder:text-[#0e3a4a]/45 focus:outline-none sm:text-lg"
        />
        {searching && intent.count !== null && (
          <span className="shrink-0 animate-[pop_160ms_ease-out] rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-200">
            {t('countChip', { count: intent.count })}
          </span>
        )}
        <button type="button" onClick={submit} aria-label={t('send')} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0e3a4a] text-white transition active:scale-90">
          {busy || loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
