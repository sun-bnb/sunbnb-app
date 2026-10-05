/**
 * The landing journey as ONE conversation (track 027 D11): a pure reducer over what the visitor
 * does (taps, typed text, async results), producing the step and the thread.
 *
 * The thread is product-first: the agent's lines are short, every action the visitor takes is
 * echoed as THEIR message, and the step UIs ride on the latest agent message as attachments.
 * Agent lines are i18n keys + params, so this file stays pure and testable; free-form text (typed
 * by the visitor, or written by the model) is carried as `text`.
 */
import type { Run } from './intent.ts'
import { isSpanishAddress, planModules, type Module } from './modules.ts'

export type Step =
  | 'beach' // find your beach
  | 'flying' // map flying in, shoreline being read (the qualifier is asked here)
  | 'count' // how many sunbeds → build
  | 'building'
  | 'guest' // be your first guest: tap a bed
  | 'bed' // bed chosen: set price → reserve
  | 'pay'
  | 'pass'
  | 'staff' // your morning: check the guest in
  | 'checked'
  | 'module' // a feature module chosen by lib/modules.ts (D10)
  | 'summary' // "Your Sunbnb": what they played through
  | 'numbers' // P10: their own numbers on each plan
  | 'live' // the offer + contact
  | 'done'

export type Attach = 'start' | 'runs' | 'count' | 'guest' | 'bed' | 'pay' | 'pass' | 'staff' | 'checked' | `mod_${Module}` | 'summary' | 'numbers' | 'live'

export interface Msg {
  id: number
  from: 'agent' | 'me'
  /** i18n key under `Thread.` — or `text` for free-form lines. */
  key?: string
  params?: Record<string, string | number>
  text?: string
  attach?: Attach
}

export interface JourneyBeach {
  placeId: string
  name: string
  address: string
  lat: number
  lng: number
}

export interface JourneyState {
  step: Step
  msgs: Msg[]
  nextId: number
  beach: JourneyBeach | null
  count: number
  runs: Run[] | null
  /** The shoreline answer is in (snapped or not) — the count step can open. */
  shoreRead: boolean
  token: string | null
  bed: { label: string; row: number } | null
  guestBed: string | null
  price: number
  booked: string[]
  checkedIn: string[]
  /** Modules planned after the staff mission (fixed when the first one starts), and how many have started. */
  plan: Module[] | null
  played: Module[]
}

export const START_PRICE_EUR = 20

export type JourneyEvent =
  | { type: 'beachPicked'; beach: JourneyBeach; count: number | null; runs: Run[] }
  | { type: 'runsChosen'; runs: Run[]; echo: string }
  /** `snapped`: the parcel was turned to a real shoreline; false = the visitor must turn it. */
  | { type: 'shoreRead'; snapped: boolean }
  | { type: 'countSet'; count: number }
  | { type: 'build' }
  | { type: 'built'; token: string }
  | { type: 'buildFailed' }
  | { type: 'bedTapped'; label: string; row: number }
  | { type: 'priceSet'; price: number }
  | { type: 'reserve' }
  | { type: 'paid' }
  | { type: 'toStaff' }
  | { type: 'checkIn'; label: string }
  /** Next feature module, or the summary when none remain. `echo`: the visitor's line for what they just did. */
  | { type: 'continue'; echoKey?: string }
  | { type: 'toNumbers' }
  | { type: 'toLive' }
  | { type: 'demoRequested' }
  | { type: 'changeBeach' }
  | { type: 'say'; from: 'agent' | 'me'; text: string }
  | { type: 'sayKey'; key: string; params?: Msg['params'] }

export function initialJourney(): JourneyState {
  return push(
    { step: 'beach', msgs: [], nextId: 1, beach: null, count: 0, runs: null, shoreRead: false, token: null, bed: null, guestBed: null, price: START_PRICE_EUR, booked: [], checkedIn: [], plan: null, played: [] },
    { from: 'agent', key: 'greeting', attach: 'start' },
  )
}

/** A saved mockup reopened from its link: straight to the guest mission on their beach. */
export function resumedJourney(r: { beach: JourneyBeach; count: number; token: string; runs?: Run[] | null }): JourneyState {
  const s: JourneyState = { ...initialJourney(), msgs: [], nextId: 1, step: 'guest', beach: r.beach, count: r.count, token: r.token, shoreRead: true, runs: r.runs ?? null }
  return push(s, { from: 'agent', key: 'welcomeBack', params: { beach: r.beach.name, count: r.count }, attach: 'guest' })
}

function push(s: JourneyState, ...msgs: Omit<Msg, 'id'>[]): JourneyState {
  let id = s.nextId
  return { ...s, msgs: [...s.msgs, ...msgs.map((m) => ({ ...m, id: id++ }))], nextId: id }
}

/** The attachment that is live (interactive) — only the latest agent message's. */
export function liveAttach(s: JourneyState): { id: number; attach: Attach } | null {
  for (let i = s.msgs.length - 1; i >= 0; i--) {
    const m = s.msgs[i]!
    if (m.from === 'agent' && m.attach) return { id: m.id, attach: m.attach }
    if (m.from === 'agent' && m.key) return null // a newer plain agent line retired the old attachment
  }
  return null
}

function openCount(s: JourneyState, snapped: boolean): JourneyState {
  // Never claim "facing the sea" unless a shoreline actually turned it.
  const key = (s.count > 0 ? 'countHave' : 'countAsk') + (snapped ? '' : 'Manual')
  return push({ ...s, step: 'count' }, { from: 'agent', key, params: s.count > 0 ? { count: s.count } : undefined, attach: 'count' })
}

export function journeyReducer(s: JourneyState, e: JourneyEvent): JourneyState {
  switch (e.type) {
    case 'beachPicked': {
      if (s.step !== 'beach') return s
      const runs = e.runs.length ? e.runs : null
      const next: JourneyState = { ...s, step: 'flying', beach: e.beach, count: e.count ?? 0, runs, shoreRead: false }
      const me: Omit<Msg, 'id'> = e.count ? { from: 'me', key: 'meBeachCount', params: { beach: e.beach.name, count: e.count } } : { from: 'me', text: e.beach.name }
      // The qualifier rides the fly-in's dead time (D10) — unless the sentence already answered it.
      return push(next, me, runs ? { from: 'agent', key: 'flying', params: { beach: e.beach.name } } : { from: 'agent', key: 'flyingAskRuns', params: { beach: e.beach.name }, attach: 'runs' })
    }
    case 'runsChosen': {
      if (s.runs !== null || s.step !== 'flying') return s
      return push({ ...s, runs: e.runs }, { from: 'me', text: e.echo }, { from: 'agent', key: 'runsNoted' })
    }
    case 'shoreRead': {
      if (s.step !== 'flying') return s
      // Never trap the visitor on the question: the count opens when the shore is ready, answered
      // or not (an unanswered qualifier stays null — "didn't say", not "just sunbeds").
      return openCount({ ...s, shoreRead: true }, e.snapped)
    }
    case 'countSet':
      // Before the beach: nothing to place yet. While building: the saved count is in flight.
      if (s.step === 'beach' || s.step === 'building') return s
      return { ...s, count: Math.max(0, Math.round(e.count)) }
    case 'build':
      if (s.step !== 'count' || s.count < 1) return s
      return push({ ...s, step: 'building' }, { from: 'me', key: 'meBuild', params: { count: s.count } })
    case 'built':
      if (s.step !== 'building') return s
      return push({ ...s, step: 'guest', token: e.token }, { from: 'agent', key: 'built', params: { beach: s.beach?.name ?? '', count: s.count }, attach: 'guest' })
    case 'buildFailed':
      if (s.step !== 'building') return s
      return push({ ...s, step: 'count' }, { from: 'agent', key: 'buildFailed', attach: 'count' })
    case 'bedTapped': {
      if (!['guest', 'bed', 'pay'].includes(s.step) || s.booked.includes(e.label)) return s
      return push({ ...s, step: 'bed', bed: { label: e.label, row: e.row } }, { from: 'me', key: 'meBed', params: { label: e.label } }, { from: 'agent', key: e.row === 0 ? 'bedFront' : 'bedRow', params: { label: e.label, row: rowLetter(e.label) }, attach: 'bed' })
    }
    case 'priceSet':
      if (s.step !== 'bed') return s
      return { ...s, price: Math.max(1, Math.min(500, Math.round(e.price))) }
    case 'reserve':
      if (s.step !== 'bed' || !s.bed) return s
      return push({ ...s, step: 'pay' }, { from: 'me', key: 'meReserve', params: { price: s.price } }, { from: 'agent', key: 'payAsk', attach: 'pay' })
    case 'paid':
      if (s.step !== 'pay' || !s.bed) return s
      return push(
        { ...s, step: 'pass', guestBed: s.bed.label, booked: [...s.booked, s.bed.label] },
        { from: 'me', key: 'mePaid', params: { price: s.price } },
        { from: 'agent', key: 'paid', params: { label: s.bed.label }, attach: 'pass' },
      )
    case 'toStaff': {
      if (!['guest', 'bed', 'pay', 'pass'].includes(s.step)) return s
      return push({ ...s, step: 'staff' }, { from: 'me', key: 'meMorning' }, { from: 'agent', key: 'staffAsk', params: { label: staffBed(s) }, attach: 'staff' })
    }
    case 'checkIn': {
      if (s.step !== 'staff' || s.checkedIn.includes(e.label)) return s
      const next = { ...s, checkedIn: [...s.checkedIn, e.label] }
      if (e.label !== staffBed(s)) return next // the example bookings check in silently
      return push({ ...next, step: 'checked' }, { from: 'me', key: 'meCheckIn', params: { label: e.label } }, { from: 'agent', key: 'checked', attach: 'checked' })
    }
    case 'continue': {
      if (!['checked', 'module', 'staff'].includes(s.step)) return s
      const plan = s.plan ?? planModules({ runs: s.runs, spain: isSpanishAddress(s.beach?.address ?? '') })
      const echo: Omit<Msg, 'id'>[] = e.echoKey ? [{ from: 'me', key: e.echoKey }] : []
      const nextModule = plan[s.played.length]
      if (nextModule) {
        return push({ ...s, step: 'module', plan, played: [...s.played, nextModule] }, ...echo, { from: 'agent', key: `mod_${nextModule}`, params: { beach: s.beach?.name ?? '' }, attach: `mod_${nextModule}` })
      }
      return push({ ...s, step: 'summary', plan }, ...echo, { from: 'agent', key: 'summary', params: { beach: s.beach?.name ?? '' }, attach: 'summary' })
    }
    case 'toNumbers':
      if (s.step !== 'summary') return s
      return push({ ...s, step: 'numbers' }, { from: 'me', key: 'meNumbers' }, { from: 'agent', key: 'numbersAsk', attach: 'numbers' })
    case 'toLive':
      if (!['staff', 'checked', 'guest', 'pass', 'module', 'summary', 'numbers'].includes(s.step)) return s
      return push({ ...s, step: 'live' }, { from: 'me', key: 'meLive' }, { from: 'agent', key: 'liveAsk', params: { beach: s.beach?.name ?? '' }, attach: 'live' })
    case 'demoRequested':
      if (s.step === 'done') return s
      return push({ ...s, step: 'done' }, { from: 'agent', key: 'thanks' })
    case 'changeBeach':
      if (s.token || s.step === 'building') return s
      return initialJourney()
    case 'say':
      return e.text.trim() ? push(s, { from: e.from, text: e.text.trim() }) : s
    case 'sayKey':
      return push(s, { from: 'agent', key: e.key, params: e.params })
  }
}

/** The bed the staff mission checks in: the visitor's own booking, else a front-row example. */
export function staffBed(s: JourneyState): string {
  return s.guestBed ?? 'A1'
}

function rowLetter(label: string): string {
  return label.replace(/\d+$/, '')
}
