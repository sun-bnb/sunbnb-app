'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MAX_SUNBEDS, parseSunbedCount } from '@/lib/places.ts'

interface Suggestion {
  placeId: string
  main: string
  secondary: string
}

type SearchState = 'idle' | 'loading' | 'error'

const DEBOUNCE_MS = 250

/**
 * The two-field form that starts the funnel (track 027 D1): pick a beach from Places
 * autocomplete, type a sunbed count, go to /beach. The beach must be PICKED from the list —
 * free text has no coordinates to build a mockup on.
 */
export default function BeachForm() {
  const t = useTranslations('Form')
  const locale = useLocale()
  const router = useRouter()
  const ids = { beach: useId(), list: useId(), beds: useId(), error: useId() }

  // One Places session per form visit: every keystroke plus the final details lookup bill once.
  const session = useMemo(() => crypto.randomUUID(), [])

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Suggestion | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [beds, setBeds] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setSuggestions([])
      setSearchState('idle')
      return
    }
    const seq = ++requestSeq.current
    const timer = setTimeout(async () => {
      setSearchState('loading')
      try {
        const params = new URLSearchParams({ input: query, session, lang: locale })
        const res = await fetch(`/api/places/autocomplete?${params}`)
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { suggestions: Suggestion[] }
        if (seq !== requestSeq.current) return // a newer keystroke won
        setSuggestions(data.suggestions)
        setActive(data.suggestions.length ? 0 : -1)
        setSearchState('idle')
        setOpen(true)
      } catch {
        if (seq === requestSeq.current) setSearchState('error')
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, selected, session, locale])

  function choose(s: Suggestion) {
    setSelected(s)
    setQuery(s.secondary ? `${s.main}, ${s.secondary}` : s.main)
    setOpen(false)
    setError(null)
  }

  function onBeachKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      choose(suggestions[active]!)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return setError(t('errorPickBeach'))
    const count = parseSunbedCount(beds)
    if (count === null) return setError(t('errorSunbeds', { max: MAX_SUNBEDS }))
    setSubmitting(true)
    const params = new URLSearchParams({ place: selected.placeId, beds: String(count), s: session })
    // Carry ad attribution through to the mockup page (and later the lead record).
    for (const [k, v] of new URLSearchParams(window.location.search)) {
      if (k.startsWith('utm_')) params.set(k, v)
    }
    router.push(`/beach?${params}`)
  }

  const showList = open && !selected && query.trim().length >= 2

  return (
    <form onSubmit={onSubmit} noValidate className="card space-y-4 p-5 shadow-sm sm:p-6">
      <div className="relative">
        <label htmlFor={ids.beach} className="label">
          {t('beachLabel')}
        </label>
        <input
          id={ids.beach}
          className="input-lg"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={ids.list}
          aria-activedescendant={showList && active >= 0 ? `${ids.list}-${active}` : undefined}
          aria-describedby={error ? ids.error : undefined}
          autoComplete="off"
          placeholder={t('beachPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(null)
            setOpen(true)
          }}
          onKeyDown={onBeachKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {showList && (
          <ul
            id={ids.list}
            role="listbox"
            className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {searchState === 'loading' && !suggestions.length && (
              <li className="px-4 py-2 text-sm text-gray-500">{t('searching')}</li>
            )}
            {searchState === 'error' && <li className="px-4 py-2 text-sm text-red-600">{t('errorSearch')}</li>}
            {searchState === 'idle' && !suggestions.length && (
              <li className="px-4 py-2 text-sm text-gray-500">{t('noResults')}</li>
            )}
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                id={`${ids.list}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-4 py-2 ${i === active ? 'bg-gray-100' : ''}`}
              >
                <span className="block text-sm font-medium text-gray-900">{s.main}</span>
                {s.secondary && <span className="block text-xs text-gray-500">{s.secondary}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor={ids.beds} className="label">
          {t('sunbedsLabel')}
        </label>
        <input
          id={ids.beds}
          className="input-lg"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={t('sunbedsPlaceholder')}
          value={beds}
          onChange={(e) => {
            setBeds(e.target.value.replace(/\D/g, '').slice(0, 5))
            setError(null)
          }}
        />
      </div>

      {error && (
        <p id={ids.error} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary-lg w-full" disabled={submitting}>
        {t('submit')}
      </button>
    </form>
  )
}
