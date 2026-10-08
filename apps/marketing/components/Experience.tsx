'use client'

import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { LeadLayout } from '@repo/data/lead-model'
import { createMockup, saveLayout, saveProjection } from '@/app/actions'
import { haptic } from '@/lib/app-sprites.ts'
import { generateBeachLayout, type LayoutInput, type MockSunbed } from '@/lib/beach-layout.ts'
import type { GeoPoint, ShoreFrame } from '@/lib/coastline.ts'
import { keepOnLand, parcelDepthFromWater, parcelGround, shoreBand } from '@/lib/land-fit.ts'
import type { GuideAction } from '@/lib/guide.ts'
import { isAffirmative, parseBareCount, parsePrice, type Intent, type Run } from '@/lib/intent.ts'
import { initialJourney, journeyReducer, liveAttach, resumedJourney, staffBed, type Attach, type JourneyBeach, type Step } from '@/lib/journey.ts'
import { hintBed } from '@/lib/missions.ts'
import { DEMO_PRICES, drinksTotal } from '@/lib/demo-prices.ts'
import type { Offer } from '@/lib/offer.ts'
import { setTrackingContext, track } from '@/lib/track.ts'
import Composer, { EXAMPLE_COUNT, EXAMPLE_QUERY, useBeachSearch, type BeachSuggestion } from './Composer'
import DemoRequestForm from './DemoRequestForm'
import OfferNote from './OfferNote'
import type { FloatTag } from './SunbedOverlay'
import Thread from './Thread'
import { BedCard, BigButton, chipCls, Chips, CountCard, DayCloseCard, OrderCard, PassCard, PayCard, RentalCard, RunsChips, StaffCard, SummaryCard, TablesCard, VerifactuCard, ProjectionCard, cardCls } from './ThreadAttach'
import World, { FLY_MS, type Insets } from './World'
import HeroSlides, { type HeroSlide } from './HeroSlides'
import HeroVignettes from './HeroVignettes'
import type { HeroMode } from './HeroBeach'

type Frame = Required<Pick<LayoutInput, 'anchor' | 'seaBearingDeg' | 'placement'>>
type CoastlineAnswer = { frame: ShoreFrame | null; shore?: GeoPoint[][]; water?: GeoPoint[][] }

const SNAP_MS = 900
const PAY_MS = 900
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const shortestTurn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180
const GUIDE_STEPS: readonly Step[] = ['beach', 'flying', 'count', 'building']
/** One feature per slide on the first screen — only SHIPPED features (lib/agent/knowledge.ts), except
 * `device`, the parasol status indicator, whose slide says it is in testing. */
const SLIDE_MODES: HeroMode[] = ['book', 'device', 'order', 'rent', 'checkin', 'invoice']
const SLIDE_MS = 5500

export interface ResumeProps {
  beach: JourneyBeach
  count: number
  token: string
  saved: LeadLayout | null
  variant: string | null
  runs: Run[] | null
}

/**
 * The whole try.sunbnb.app visit as ONE experience (track 027 D11): a world that never reloads
 * (illustrated beach → the prospect's map) and one conversation floating over it, driven by one
 * bar. Landing (`/`) and a saved mockup (`/m/<token>`) are the same component in different states.
 *
 * Typed text goes through rules first (`lib/intent.ts`); anything else goes to the agent — the
 * stateless guide (`/api/guide`) before a mockup exists, the lead chat (`/api/chat`) after.
 */
export default function Experience({
  apiKey,
  title,
  subtitle,
  offer,
  angle,
  chatEnabled,
  resume,
}: {
  apiKey: string
  title: string
  subtitle: string
  offer: Offer | null
  angle: string | null
  chatEnabled: boolean
  resume?: ResumeProps
}) {
  const t = useTranslations('Thread')
  const tc = useTranslations('Chat')
  const th = useTranslations('Hero')
  const locale = useLocale()
  const [s, dispatch] = useReducer(journeyReducer, undefined, () => (resume ? resumedJourney(resume) : initialJourney()))
  const [frame, setFrame] = useState<Frame | null>(() =>
    resume?.saved
      ? { anchor: { lat: resume.saved.anchorLat, lng: resume.saved.anchorLng }, seaBearingDeg: resume.saved.seaBearingDeg, placement: resume.saved.placement }
      : resume
        ? { anchor: { lat: resume.beach.lat, lng: resume.beach.lng }, seaBearingDeg: 180, placement: 'center' }
        : null,
  )
  const frameRef = useRef(frame)
  frameRef.current = frame
  const [fitKey, setFitKey] = useState(resume ? 1 : 0)
  const [typing, setTyping] = useState(false)
  const [paying, setPaying] = useState(false)
  const [tag, setTag] = useState<FloatTag | null>(null)
  const [priceTouched, setPriceTouched] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [moving, setMoving] = useState(false)
  const chatSession = useMemo(() => crypto.randomUUID(), [])
  const guideHistory = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const pendingCount = useRef<number | null>(null)

  // Async handlers (agent replies, place lookups) must act on the state as it is when they land.
  const sRef = useRef(s)
  sRef.current = s
  const say = useCallback((key: string) => dispatch({ type: 'sayKey', key }), [])
  const sayText = useCallback((text: string) => dispatch({ type: 'say', from: 'agent', text }), [])
  const search = useBeachSearch({ enabled: s.step === 'beach', onSay: say })

  // ── First-screen feature showcase: the ad's promise first, then one feature at a time ──
  const slides: HeroSlide[] = useMemo(
    () =>
      SLIDE_MODES.map((mode) =>
        mode === 'book' ? { mode, title, subtitle } : { mode, title: th(`slides.${mode}.title`), subtitle: th(`slides.${mode}.subtitle`) },
      ),
    [title, subtitle, th],
  )
  const heroTags = useMemo(
    () => Object.fromEntries(SLIDE_MODES.map((m) => [m, m === 'book' ? th('sceneTag') : th(`slides.${m}.tag`)])) as Record<HeroMode, string>,
    [th],
  )
  const [slide, setSlide] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches), [])
  // Wide screens show each feature's scene in a column beside the headline (the strip of sand
  // between headline and composer is too short to show it at a readable size there).
  const [desk, setDesk] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setDesk(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // The showcase steps aside the moment the visitor engages: typing, a reply, or anything said.
  const showcasing = !s.beach && !reducedMotion && !search.text && s.msgs.length <= 1 && !typing
  useEffect(() => {
    if (!showcasing) return
    const timer = setTimeout(() => setSlide((i) => (i + 1) % SLIDE_MODES.length), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [showcasing, slide])

  useEffect(() => {
    setTrackingContext(resume ? { token: resume.token, variant: resume.variant } : { angle })
  }, [])

  // ── The world's geometry ────────────────────────────────────────────────
  /** The real coastline near the beach, when we have it: keeps every bed on the sand. */
  const [shore, setShore] = useState<{ ways: GeoPoint[][]; seaBearingDeg: number; water: GeoPoint[][] } | null>(null)
  // What the visitor set (snap, turn, move) → where it actually sits: slid inland if any bed would
  // be in the water. This is the frame that is drawn AND saved.
  const placed = useMemo(
    () => (frame && shore && s.count > 0 ? keepOnLand(frame, s.count, shore.ways, { shoreSeaBearingDeg: shore.seaBearingDeg, water: shore.water }) : frame),
    [frame, shore, s.count],
  )
  const placedRef = useRef(placed)
  placedRef.current = placed
  const layout = useMemo(
    () => (placed && s.count > 0 ? generateBeachLayout({ ...placed, sunbedCount: s.count }) : null),
    [placed, s.count],
  )
  // Sand to paint under the beds (see lib/land-fit.ts): a strip along the OSM coast from the
  // waterline to just behind the back row — one continuous beach where Google draws water — plus
  // the parcel's own pad.
  const ground = useMemo(() => {
    if (!layout || !placed || !shore) return null
    const depth = parcelDepthFromWater(layout.sunbeds, shore.ways, shore.water)
    const band = depth !== null && depth > 0 ? shoreBand(shore.ways, Math.min(depth + 3, 60), shore.water) : []
    return [...band, parcelGround(layout.sunbeds, placed)]
  }, [layout, placed, shore])

  // Once the visit is about a beach, the page is an app: no page scroll under the map.
  useEffect(() => {
    if (!s.beach) return
    window.scrollTo({ top: 0 })
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    // Pins the site header to the screen too (SiteChrome): iOS still scrolls the page when the
    // keyboard opens, which carried the page-attached header — the only way out — off screen.
    html.dataset.chat = '1'
    return () => {
      html.style.overflow = prev
      delete html.dataset.chat
    }
  }, [s.beach])

  // The camera's flight to the beach (World reports when it lands). A fallback releases waiters
  // if the map never flies (no key, tiles blocked) so the visit can't stall on it.
  const flight = useRef<{ landed: boolean; waiters: (() => void)[] }>({ landed: false, waiters: [] })
  function whenLanded(fn: () => void) {
    if (flight.current.landed) return fn()
    flight.current.waiters.push(fn)
    const f = flight.current
    setTimeout(() => {
      if (f.waiters.includes(fn)) {
        f.waiters = f.waiters.filter((w) => w !== fn)
        fn()
      }
    }, FLY_MS * 3)
  }
  function onFlown() {
    const f = flight.current
    f.landed = true
    const ws = f.waiters
    f.waiters = []
    ws.forEach((w) => w())
  }

  // Read the shoreline while the camera flies; then turn the parcel to face the sea, visibly.
  useEffect(() => {
    if (!s.beach || s.step !== 'flying') return
    const beach = s.beach
    let cancelled = false
    flight.current = { landed: false, waiters: [] }
    setFrame({ anchor: { lat: beach.lat, lng: beach.lng }, seaBearingDeg: 180, placement: 'center' })
    setShore(null)
    fetch(`/api/coastline?lat=${beach.lat}&lng=${beach.lng}`)
      .then((r) => (r.ok ? (r.json() as Promise<CoastlineAnswer>) : { frame: null }))
      .catch((): CoastlineAnswer => ({ frame: null }))
      .then(({ frame: shore, shore: ways, water }) => {
        if (cancelled) return
        // Never turn the parcel before the camera lands on it — the turn should be seen.
        whenLanded(() => {
          if (cancelled) return
          const done = (snapped: boolean) => {
            dispatch({ type: 'shoreRead', snapped })
            setFitKey((k) => k + 1)
          }
          if (!shore) return done(false)
          if (ways?.length) setShore({ ways, seaBearingDeg: shore.seaBearingDeg, water: water ?? [] })
          animateTo({ anchor: shore.waterline, seaBearingDeg: shore.seaBearingDeg, placement: 'waterline' }, () => {
            haptic(14)
            done(true)
          })
        })
      })
    return () => {
      cancelled = true
    }
  }, [s.beach?.placeId])

  // A saved mockup opened before its shore was ever read: snap now, and save it for the link.
  useEffect(() => {
    if (!resume || resume.saved) return
    let cancelled = false
    fetch(`/api/coastline?lat=${resume.beach.lat}&lng=${resume.beach.lng}`)
      .then((r) => (r.ok ? (r.json() as Promise<CoastlineAnswer>) : { frame: null }))
      .then(({ frame: shore, shore: ways, water }) => {
        if (cancelled || !shore) return
        const snapped: Frame = { anchor: shore.waterline, seaBearingDeg: shore.seaBearingDeg, placement: 'waterline' }
        const f = ways?.length ? keepOnLand(snapped, resume.count, ways, { shoreSeaBearingDeg: shore.seaBearingDeg, water }) : snapped
        if (ways?.length) setShore({ ways, seaBearingDeg: shore.seaBearingDeg, water: water ?? [] })
        setFrame(f)
        setFitKey((k) => k + 1)
        void saveLayout(resume.token, { anchorLat: f.anchor.lat, anchorLng: f.anchor.lng, seaBearingDeg: f.seaBearingDeg, placement: f.placement })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function animateTo(target: Frame, done: () => void) {
    const from = frameRef.current ?? target
    const turn = shortestTurn(from.seaBearingDeg, target.seaBearingDeg)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = reduced ? 1 : Math.min(1, (now - t0) / SNAP_MS)
      const e = easeInOut(k)
      setFrame({
        anchor: { lat: from.anchor.lat + (target.anchor.lat - from.anchor.lat) * e, lng: from.anchor.lng + (target.anchor.lng - from.anchor.lng) * e },
        seaBearingDeg: Math.round((((from.seaBearingDeg + turn * e) % 360) + 360) % 360),
        placement: k < 1 ? from.placement : target.placement,
      })
      if (k < 1) requestAnimationFrame(tick)
      else {
        setFrame(target)
        done()
      }
    }
    requestAnimationFrame(tick)
  }

  /** Manual turn when the shoreline couldn't be read (or the visitor knows better). */
  const adjusted = useRef(false)
  const rotateTimer = useRef<number>()
  function rotate(delta: number) {
    haptic(6)
    adjusted.current = true
    setFrame((f) => (f ? { ...f, seaBearingDeg: (((f.seaBearingDeg + delta) % 360) + 360) % 360 } : f))
    // Re-frame once the turning stops: a turned parcel can swing under the conversation.
    window.clearTimeout(rotateTimer.current)
    rotateTimer.current = window.setTimeout(() => setFitKey((k) => k + 1), 500)
  }
  function moveTo(ll: { lat: number; lng: number }) {
    haptic(10)
    adjusted.current = true
    setMoving(false)
    setFrame((f) => (f ? { ...f, anchor: ll, placement: 'center' } : f))
    setFitKey((k) => k + 1)
  }

  // The count settling re-frames the camera and is one funnel event (not one per tap).
  const countTimer = useRef<number>()
  function setCount(n: number) {
    dispatch({ type: 'countSet', count: n })
    window.clearTimeout(countTimer.current)
    countTimer.current = window.setTimeout(() => {
      setFitKey((k) => k + 1)
      track('beds_count_set', { count: n })
    }, 450)
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async function pickBeach(sg: BeachSuggestion, intent: Intent) {
    setTyping(true)
    try {
      const res = await fetch(`/api/places/details?${new URLSearchParams({ placeId: sg.placeId, session: search.session, lang: locale })}`)
      if (!res.ok) throw new Error(String(res.status))
      const d = (await res.json()) as { name: string; address: string; lat: number; lng: number }
      const count = intent.count ?? pendingCount.current
      pendingCount.current = null
      dispatch({ type: 'beachPicked', beach: { placeId: sg.placeId, ...d }, count, runs: intent.runs })
    } catch {
      say('pickError')
    } finally {
      setTyping(false)
    }
  }

  async function example() {
    track('search_start')
    haptic(8)
    const found = await search.find(EXAMPLE_QUERY)
    search.setText('')
    if (found?.[0]) void pickBeach(found[0], { query: EXAMPLE_QUERY, count: EXAMPLE_COUNT, runs: [] })
  }

  async function build() {
    // The frame as drawn — after keeping it on the sand — is the one the link reopens.
    const f = placedRef.current
    if (!s.beach || !f || s.count < 1) return
    dispatch({ type: 'build' })
    haptic(18)
    const data = new FormData()
    data.set('place', s.beach.placeId)
    data.set('beds', String(s.count))
    data.set('session', search.session)
    data.set('anchorLat', String(f.anchor.lat))
    data.set('anchorLng', String(f.anchor.lng))
    data.set('seaBearingDeg', String(f.seaBearingDeg))
    data.set('placement', f.placement)
    if (adjusted.current) data.set('adjusted', '1')
    if (s.runs !== null) data.set('runs', s.runs.length ? s.runs.join(',') : 'none')
    for (const [k, v] of new URLSearchParams(window.location.search)) {
      if (k.startsWith('utm_') || k === 'a' || k === 'gclid' || k === 'fbclid' || k === 'v') data.set(k, v)
    }
    const res = await createMockup(data).catch(() => null)
    if (res?.status !== 'ok') return dispatch({ type: 'buildFailed' })
    // Same world, new address: the link now reopens this beach. No reload, no blink.
    // `__NA` makes Next's patched replaceState leave its router alone: the router must stay on
    // this page. Letting it follow the URL made every later server action (saveProjection,
    // requestDemo) re-render /m/[token] — a fresh visit that wiped the whole conversation.
    window.history.replaceState({ ...(window.history.state ?? {}), __NA: true }, '', `/m/${res.token}`)
    setTrackingContext({ token: res.token, variant: res.variant })
    track('mockup_created', undefined, { beacon: false }) // counted server-side; this is the ad pixel
    dispatch({ type: 'built', token: res.token })
    setFitKey((k) => k + 1)
    haptic(25)
  }

  function onBedTap(bed: MockSunbed) {
    if (!['guest', 'bed', 'pay'].includes(s.step) || paying) return
    dispatch({ type: 'bedTapped', label: bed.label, row: bed.row })
  }

  function pay() {
    if (!s.bed || paying) return
    setPaying(true)
    track('guest_demo_start')
    const label = s.bed.label
    setTimeout(() => {
      dispatch({ type: 'paid' })
      setTag({ label, text: t('paidTag', { price: s.price }), at: performance.now() })
      setPaying(false)
      haptic(25)
      track('guest_demo_done')
      if (priceTouched) track('price_set')
    }, PAY_MS)
  }

  // ── The bar: rules first, the agent for everything else ──────────────────
  function onSubmit(text: string) {
    const step = s.step
    if (step === 'count' || step === 'flying') {
      const n = parseBareCount(text)
      if (n !== null) {
        dispatch({ type: 'say', from: 'me', text })
        return setCount(n)
      }
      if (step === 'count' && isAffirmative(text) && s.count > 0) return void build()
    }
    if (step === 'bed') {
      const p = parsePrice(text)
      if (p !== null) {
        dispatch({ type: 'say', from: 'me', text: `€${p}` })
        setPriceTouched(true)
        return dispatch({ type: 'priceSet', price: p })
      }
    }
    void askAgent(text)
  }

  async function askAgent(text: string) {
    dispatch({ type: 'say', from: 'me', text })
    if (!chatEnabled) return say('agentOff')
    setTyping(true)
    try {
      if (!s.token) {
        const res = await fetch('/api/guide', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: chatSession,
            step: GUIDE_STEPS.includes(s.step) ? s.step : 'beach',
            beachName: s.beach?.name ?? null,
            sunbedCount: s.count,
            history: guideHistory.current.slice(-12),
            message: text,
          }),
        })
        const data = (await res.json().catch(() => ({ status: 'unavailable' }))) as { status: string; reply?: string; actions?: GuideAction[] }
        if (data.status !== 'ok') return sayText(tc(data.status === 'rate_limited' ? 'rateLimited' : data.status === 'limit' ? 'limit' : 'unavailable'))
        guideHistory.current.push({ role: 'user', content: text })
        if (data.reply) {
          guideHistory.current.push({ role: 'assistant', content: data.reply })
          sayText(data.reply)
        }
        for (const a of data.actions ?? []) {
          if (a.type === 'findBeach' && sRef.current.step === 'beach') {
            const found = await search.find(a.query)
            if (!data.reply) say(found?.length ? 'pickOne' : 'noMatch')
          } else if (a.type === 'setCount') {
            if (!sRef.current.beach) pendingCount.current = a.count
            else setCount(a.count)
            if (!data.reply) dispatch({ type: 'say', from: 'agent', text: t('placed', { count: a.count }) })
          }
        }
        return
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: s.token, sessionId: chatSession, message: text }),
      })
      const data = (await res.json().catch(() => ({ status: 'unavailable' }))) as { status: string; reply?: string; sunbedCount?: number; demoRequested?: boolean }
      if (data.status !== 'ok') return sayText(tc(data.status === 'rate_limited' ? 'rateLimited' : data.status === 'limit' ? 'limit' : 'unavailable'))
      if (data.reply) sayText(data.reply)
      if (data.sunbedCount && data.sunbedCount !== sRef.current.count) setCount(data.sunbedCount)
      if (data.demoRequested) {
        track('demo_requested', { via: 'chat' }, { beacon: false })
        dispatch({ type: 'demoRequested' })
      }
    } catch {
      sayText(tc('unavailable'))
    } finally {
      setTyping(false)
    }
  }

  // ── Floating UI geometry: the world frames the beach in what the conversation leaves ──
  const stageRef = useRef<HTMLElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [insets, setInsets] = useState<Insets>({ top: 64, bottom: 280, left: 0 })
  const [scene, setScene] = useState<{ shore: number; band: [number, number] } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!stage || !panel) return
      const wide = window.matchMedia('(min-width: 1024px)').matches && !!s.beach
      setInsets((prev) => {
        // Capped at half the screen: framing the beach in a sliver above a tall step UI would zoom the
        // map out until the beds collapse into the parcel outline — the beach stays tappable instead.
        const next = wide ? { top: 64, bottom: 0, left: panel.width + 24 } : { top: 64, bottom: Math.round(Math.min(stage.bottom - panel.top, stage.height * 0.5)), left: 0 }
        return prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left ? prev : next
      })
      const head = headRef.current?.getBoundingClientRect()
      if (!head || s.beach) return
      const r = (n: number) => Math.round(n * 100) / 100
      const shore = r(Math.min(0.6, (head.bottom - stage.top + 18) / stage.height))
      const bandTop = r(shore + 32 / stage.height)
      const bandBottom = r(Math.max(bandTop + 0.12, (panel.top - stage.top - 8) / stage.height))
      setScene((prev) => (prev && prev.shore === shore && prev.band[0] === bandTop && prev.band[1] === bandBottom ? prev : { shore, band: [bandTop, bandBottom] }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const el of [stageRef.current, headRef.current, panelRef.current]) if (el) ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [s.beach])

  // ── Attachments: the live step UI on the agent's latest message ──────────
  const rowText = (label: string, row: number) => (row === 0 ? t('rowFront') : t('rowN', { row: label.replace(/\d+$/, '') }))
  const next = (echoKey?: string) => {
    track('cta_click', { place: `module_${s.played.at(-1) ?? 'none'}` })
    dispatch({ type: 'continue', echoKey })
  }
  const withSkip = (card: ReactNode) => (
    <div className="space-y-2">
      {card}
      <button type="button" onClick={() => dispatch({ type: 'toLive' })} className="text-xs font-medium text-[#0e3a4a]/60 underline-offset-2 hover:underline">
        {t('skipToEnd')}
      </button>
    </div>
  )
  function renderAttach(attach: Attach): ReactNode {
    switch (attach) {
      case 'start':
        return (
          <Chips>
            <button type="button" className={chipCls} onClick={() => search.nearMe(t('nearQuery'))}>
              <svg className="h-4 w-4 text-[#00a9c7]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              {t('chipNear')}
            </button>
            <button type="button" className={chipCls} onClick={() => void example()}>
              {t('chipExample')}
            </button>
          </Chips>
        )
      case 'runs':
        return <RunsChips onDone={(runs, echo) => dispatch({ type: 'runsChosen', runs, echo })} />
      case 'count':
        return (
          <div className="space-y-2">
            <CountCard count={s.count} rows={layout?.rows ?? 0} building={s.step === 'building'} onChange={setCount} onBuild={() => void build()} />
            <Chips>
              <button type="button" className={chipCls} onClick={() => rotate(-15)} aria-label={t('rotateLeft')}>
                ↺
              </button>
              <button type="button" className={chipCls} onClick={() => rotate(15)} aria-label={t('rotateRight')}>
                ↻
              </button>
              <button type="button" aria-pressed={moving} className={`${chipCls} ${moving ? '!border-[#0e3a4a] !bg-[#0e3a4a] !text-white' : ''}`} onClick={() => setMoving((m) => !m)}>
                {t('move')}
              </button>
              <button type="button" className={chipCls} onClick={() => dispatch({ type: 'changeBeach' })}>
                {t('changeBeach')}
              </button>
            </Chips>
          </div>
        )
      case 'guest':
        return (
          <Chips>
            <button type="button" className={chipCls} onClick={() => dispatch({ type: 'toStaff' })}>
              {t('skipToStaff')}
            </button>
          </Chips>
        )
      case 'bed':
        return s.bed ? (
          <BedCard
            label={s.bed.label}
            rowText={rowText(s.bed.label, s.bed.row)}
            price={s.price}
            onPrice={(p) => {
              setPriceTouched(true)
              dispatch({ type: 'priceSet', price: p })
            }}
            onReserve={() => dispatch({ type: 'reserve' })}
          />
        ) : null
      case 'pay':
        return s.bed ? <PayCard label={s.bed.label} price={s.price} paying={paying} onPay={pay} /> : null
      case 'pass':
        return s.guestBed ? <PassCard label={s.guestBed} price={s.price} onNext={() => dispatch({ type: 'toStaff' })} /> : null
      case 'staff':
        return layout ? (
          <div className="space-y-2">
            <StaffCard
              layout={layout}
              guestBed={staffBed(s)}
              checkedIn={s.checkedIn}
              onCheckIn={(label) => {
                if (label === staffBed(s)) track('operator_checked_in')
                dispatch({ type: 'checkIn', label })
              }}
            />
            <button type="button" onClick={() => dispatch({ type: 'continue' })} className="text-xs font-medium text-[#0e3a4a]/60 underline-offset-2 hover:underline">
              {t('skipToLive')}
            </button>
          </div>
        ) : null
      case 'checked':
        return <BigButton onClick={() => dispatch({ type: 'continue' })}>{t('continue')}</BigButton>
      case 'mod_order':
        return withSkip(<OrderCard guestBed={staffBed(s)} onDone={next} />)
      case 'mod_rental':
        return withSkip(<RentalCard onDone={next} />)
      case 'mod_tables':
        return withSkip(<TablesCard onDone={next} />)
      case 'mod_dayclose':
        return withSkip(
          <DayCloseCard
            // One line per thing paid in this demo: their sunbed (their own price), the drinks and
            // the rental they played (example prices, lib/demo-prices.ts).
            lines={[
              ...(s.guestBed ? [{ label: t('dc_sunbed', { label: s.guestBed }), amount: s.price }] : []),
              ...(s.played.includes('order') ? [{ label: t('dc_drinks'), amount: drinksTotal() }] : []),
              ...(s.played.includes('rental') ? [{ label: t('dc_rental'), amount: DEMO_PRICES.paddleboardHour }] : []),
            ]}
            onDone={next}
          />,
        )
      case 'mod_verifactu':
        return withSkip(<VerifactuCard onDone={() => next()} />)
      case 'summary':
        return (
          <SummaryCard
            items={[{ text: t('sum_book') }, { text: t('sum_staff') }, ...s.played.map((m) => ({ text: t(`sum_${m}`), coming: m === 'verifactu' }))]}
            onLive={() => dispatch({ type: 'toNumbers' })}
            cta={t('nextNumbers')}
          />
        )
      case 'numbers':
        return (
          <ProjectionCard
            price={s.price}
            priceConfirmed={priceTouched}
            sunbeds={s.count}
            onChange={(input) => {
              if (s.token) void saveProjection(s.token, input)
            }}
            onLive={() => dispatch({ type: 'toLive' })}
          />
        )
      case 'live':
        // Contact is a message in the bar (the lead chat captures it); the form is there for
        // those who prefer one, not in the way of those who don't.
        return s.token && s.beach ? (
          <div className="space-y-2">
            <OfferNote offer={offer} />
            {/* The bar takes an email or phone here, so the notice for that sits with the ask. */}
            <p className="px-1 text-[11px] leading-snug text-[#0e3a4a]/60">{richNode(tc.rich('notice', { link: privacyLink }))}</p>
            {showForm ? (
              <div className={`${cardCls} max-h-[45svh] overflow-y-auto`}>
                <DemoRequestForm
                  bare
                  token={s.token}
                  beachName={s.beach.name}
                  onSuccess={() => {
                    track('cta_click', { place: 'thread_form' })
                    dispatch({ type: 'demoRequested' })
                  }}
                />
              </div>
            ) : (
              <Chips>
                <button type="button" className={chipCls} onClick={() => setShowForm(true)}>
                  {t('useForm')}
                </button>
              </Chips>
            )}
          </div>
        ) : null
    }
  }

  const live = liveAttach(s)
  // The world reacts to the module being played: the drinks land on the guest's own sunbed.
  useEffect(() => {
    if (live?.attach === 'mod_order' && layout) {
      setTag({ label: staffBed(s), text: th('slides.order.tag'), at: performance.now() })
      haptic(15)
    }
  }, [live?.id])
  const hint = s.step === 'guest' && layout ? hintBed(layout)?.label ?? null : null
  const placeholder = t(
    s.step === 'beach' ? 'ph_beach' : s.step === 'flying' || s.step === 'count' ? 'ph_count' : s.step === 'bed' ? 'ph_price' : s.step === 'live' ? 'ph_live' : 'ph_ask',
  )
  const booked = useMemo(() => new Set(s.booked), [s.booked])

  return (
    // Once about a beach, the experience is pinned to the viewport: focusing an input or a long
    // thread can't scroll the page out from under the map.
    <section ref={stageRef} className={`w-full overflow-hidden ${s.beach ? 'fixed inset-0 z-10 h-[100svh]' : 'relative h-[100svh] min-h-[560px]'}`}>
      <World
        apiKey={apiKey}
        center={s.beach ? { lat: s.beach.lat, lng: s.beach.lng } : null}
        layout={layout}
        scene={scene}
        insets={insets}
        fitKey={fitKey}
        selected={s.bed && ['bed', 'pay'].includes(s.step) ? s.bed.label : null}
        booked={booked}
        hint={hint}
        tag={tag}
        onBedTap={onBedTap}
        onMapClick={moving && s.step === 'count' ? moveTo : undefined}
        // On a wide screen the features play in their own column, so the beach keeps its bookings.
        heroMode={desk ? 'book' : SLIDE_MODES[slide]}
        heroTags={heroTags}
        ground={ground}
        onFlown={onFlown}
      />
      {moving && s.step === 'count' && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4">
          <p role="status" className="rounded-full bg-[#0e3a4a]/90 px-4 py-2 text-sm text-white shadow">
            {t('moveHint')}
          </p>
        </div>
      )}

      {/* Each feature slide's own scene, scrolled in over the sand (the beach's sunbeds fade out). */}
      {!s.beach && scene && !desk && (
        <div className="pointer-events-none absolute inset-x-0" style={{ top: `${scene.band[0] * 100}%`, height: `${(scene.band[1] - scene.band[0]) * 100}%` }}>
          <HeroVignettes mode={SLIDE_MODES[slide]!} reduced={reducedMotion} />
        </div>
      )}

      {/* The landing headline floats on the sea until the visit becomes about their beach. */}
      {!s.beach && (
        <div ref={headRef} className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-[4.25rem] sm:pt-24 [@media(max-height:700px)]:pt-14">
          <div className="mx-auto max-w-3xl lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
            <div>
              <HeroSlides
                slides={slides}
                active={slide}
                intervalMs={SLIDE_MS}
                running={showcasing}
                onPick={(i) => {
                  haptic(6)
                  setSlide(i)
                }}
                showLabel={(f) => th('slides.show', { feature: f })}
              />
              {offer?.launchOfferShort && <OfferPill short={offer.launchOfferShort} full={offer.launchOffer ?? offer.launchOfferShort} />}
            </div>
            {/* Its height leaves the sand room for the beach's rows and the composer below. */}
            <div className="hidden h-[clamp(240px,calc(100svh-480px),460px)] lg:block">
              {desk && <HeroVignettes mode={SLIDE_MODES[slide]!} reduced={reducedMotion} withBook maxScale={1.9} />}
            </div>
          </div>
        </div>
      )}

      {/* The conversation + the one bar. Centred on the landing; a side column over the map on wide screens. */}
      <div
        ref={panelRef}
        className={`absolute bottom-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 ${
          s.beach ? 'inset-x-0 lg:bottom-4 lg:left-4 lg:right-auto lg:w-[420px] lg:px-0' : 'inset-x-0'
        }`}
      >
        <div className={s.beach ? '' : 'mx-auto max-w-xl'}>
          <Thread msgs={s.msgs} live={live} typing={typing} renderAttach={renderAttach} />
          <div className="mt-2">
            <Composer search={search} searching={s.step === 'beach'} placeholder={placeholder} busy={typing} onSubmit={onSubmit} onPick={(sg, intent) => void pickBeach(sg, intent)} />
          </div>
        </div>
      </div>
    </section>
  )
}

// next-intl's rich() is typed against the hoisted @types/react 19; this app is on React 18 types.
const privacyLink = (c: unknown) => (
  <Link href="/privacy" className="underline">
    {c as ReactNode}
  </Link>
)
const richNode = (n: unknown) => n as ReactNode

/** The launch offer at a glance; tapping it shows the full conditions in place. */
function OfferPill({ short, full }: { short: string; full: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pointer-events-auto relative mt-4 max-w-xl [@media(max-height:700px)]:mt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-amber-200 bg-amber-50/95 px-3 py-1 text-left text-xs font-medium [@media(max-height:700px)]:whitespace-nowrap text-amber-800 shadow-sm sm:px-3.5 sm:py-1.5 sm:text-sm"
      >
        <span className="min-w-0 truncate">{short}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M5.2 7.2a1 1 0 0 1 1.4 0L10 10.6l3.4-3.4a1 1 0 1 1 1.4 1.4l-4.1 4.1a1 1 0 0 1-1.4 0L5.2 8.6a1 1 0 0 1 0-1.4Z" clipRule="evenodd" />
        </svg>
      </button>
      {/* Overlays rather than pushes: the scene is fitted to the headline block. */}
      {open && <p className="absolute left-0 top-full z-20 mt-2 animate-[pop_160ms_ease-out] rounded-xl border border-amber-200 bg-amber-50/95 px-3.5 py-2.5 text-sm text-amber-800 shadow">{full}</p>}
    </div>
  )
}
