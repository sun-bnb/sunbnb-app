/**
 * Pure checks applied to a finished eval conversation. Each returns a list of failure messages
 * (empty = pass), so a scenario's verdict is just "no check produced a failure".
 */
import { factSheetFigures } from '../lib/agent/fact-sheet.ts'
import type { LeadState, ToolEvent } from '../lib/agent/run-turn.ts'

export type Lang = 'en' | 'es' | 'fi' | 'el'

export interface Transcript {
  /** Prospect messages, in order. */
  userMessages: string[]
  /** The agent's text reply to each prospect message. */
  replies: string[]
  toolEvents: ToolEvent[]
  lead: LeadState
  exhaustedTurns: number
}

export type Check =
  | { kind: 'tool_called'; tool: string; args?: Record<string, unknown> }
  | { kind: 'tool_not_called'; tool: string }
  | { kind: 'reply_language'; lang: Lang }
  | { kind: 'no_invented_figures' }
  | { kind: 'mentions'; pattern: RegExp; label: string; where?: 'any' | 'last' }
  | { kind: 'not_mentions'; pattern: RegExp; label: string }
  | { kind: 'max_words'; words: number }
  | { kind: 'lead_has'; field: keyof LeadState; value?: unknown }
  | { kind: 'lead_missing'; field: keyof LeadState }
  | { kind: 'no_unbacked_demo_promise' }

// ── figures ─────────────────────────────────────────────────────────────────

/**
 * Numbers the agent presents as money, percentages or counts of customers/results — the
 * claims a prospect would rely on. Bare numbers (a time, "3 sentences") are deliberately not
 * extracted: only figures attached to €, %, or a business noun count as claims.
 */
export function extractClaimedFigures(text: string): number[] {
  const out: number[] = []
  const num = String.raw`(\d+(?:[.,]\d+)?)`
  const patterns = [
    new RegExp(String.raw`€\s?${num}`, 'g'),
    new RegExp(String.raw`${num}\s?(?:€|eur\b|euros?\b|euroa?\b)`, 'gi'),
    new RegExp(String.raw`${num}\s?(?:%|per ?cent|por ciento|prosentti)`, 'gi'),
    new RegExp(
      String.raw`${num}\s?\+?\s*(?:beaches|venues|customers|clients|partners|bookings|reservations|playas|clientes|reservas|rantaa|asiakasta|varausta)`,
      'gi',
    ),
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(Number(m[1]!.replace(',', '.')))
  }
  return out
}

/** Figures the agent may quote: the fact sheet's, plus anything the prospect said themselves. */
export function allowedFigures(userMessages: string[]): Set<number> {
  const allowed = new Set<number>(factSheetFigures())
  for (const msg of userMessages) {
    for (const m of msg.matchAll(/\d+(?:[.,]\d+)?/g)) allowed.add(Number(m[0].replace(',', '.')))
  }
  return allowed
}

// ── language ────────────────────────────────────────────────────────────────

const STOPWORDS: Record<Exclude<Lang, 'el'>, string[]> = {
  en: ['the', 'and', 'you', 'your', 'is', 'to', 'of', 'for', 'with', 'can', 'are', 'it', 'we', 'on'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'tu', 'su', 'para', 'con', 'es', 'por', 'un', 'una', 'puedes', 'usted'],
  fi: ['ja', 'on', 'että', 'voit', 'sinun', 'teidän', 'kanssa', 'myös', 'se', 'ei', 'kun', 'tai', 'jos', 'mitä', 'olla', 'ovat'],
}

/** Cheap language guess — good enough to tell EN/ES/FI/Greek replies apart, which is all the eval needs. */
export function detectLanguage(text: string): Lang | 'unknown' {
  const greek = (text.match(/[Ͱ-Ͽ]/g) ?? []).length
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (letters && greek / letters > 0.3) return 'el'
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  let best: Lang | 'unknown' = 'unknown'
  let bestScore = 0
  for (const [lang, list] of Object.entries(STOPWORDS) as [Lang, string[]][]) {
    const score = words.filter((w) => list.includes(w)).length
    if (score > bestScore) {
      best = lang
      bestScore = score
    }
  }
  return best
}

// ── scoring ─────────────────────────────────────────────────────────────────

/** Wording that tells the prospect a demo, callback or email is ARRANGED (not merely offered). */
export const DEMO_PROMISE =
  /team will (?:contact|call|reach|get in touch)|(?:I|we)(?:'ll| will) let the team know|(?:I|we)(?:'ll| will) (?:send|email) you|(?:we|I)(?:'ll| will) (?:schedule|book|arrange|set up) (?:the|your|a) (?:demo|call)|demo (?:is|has been) (?:scheduled|booked|arranged)|el equipo (?:te|le) (?:contactará|llamará)|tiimimme (?:ottaa|soittaa)/i

function argsMatch(actual: Record<string, unknown> | null, expected: Record<string, unknown>): boolean {
  if (!actual) return false
  return Object.entries(expected).every(([k, v]) => {
    const a = actual[k]
    if (typeof v === 'string' && typeof a === 'string') return a.replace(/\s/g, '').toLowerCase() === v.replace(/\s/g, '').toLowerCase()
    return a === v
  })
}

export function runCheck(check: Check, t: Transcript): string[] {
  const replies = t.replies.filter(Boolean)
  switch (check.kind) {
    case 'tool_called': {
      const accepted = t.toolEvents.filter((e) => e.call.name === check.tool && e.accepted)
      if (!accepted.length) return [`expected an accepted ${check.tool} call`]
      if (check.args && !accepted.some((e) => argsMatch(e.args, check.args!))) {
        return [`${check.tool} called, but never with ${JSON.stringify(check.args)} (got ${accepted.map((e) => JSON.stringify(e.args)).join(', ')})`]
      }
      return []
    }
    case 'tool_not_called':
      return t.toolEvents.some((e) => e.call.name === check.tool && e.accepted) ? [`${check.tool} should not have been called`] : []
    case 'reply_language':
      return replies.flatMap((r, i) => {
        const lang = detectLanguage(r)
        return lang === check.lang ? [] : [`reply ${i + 1} looks ${lang}, expected ${check.lang}`]
      })
    case 'no_invented_figures': {
      const allowed = allowedFigures(t.userMessages)
      const invented = replies.flatMap((r) => extractClaimedFigures(r)).filter((f) => !allowed.has(f))
      return invented.length ? [`invented figures: ${[...new Set(invented)].join(', ')}`] : []
    }
    case 'mentions': {
      const pool = check.where === 'last' ? replies.slice(-1) : replies
      return pool.some((r) => check.pattern.test(r)) ? [] : [`never mentions ${check.label}`]
    }
    case 'not_mentions':
      return replies.some((r) => check.pattern.test(r)) ? [`mentions ${check.label}`] : []
    case 'max_words':
      return replies.flatMap((r, i) => {
        const n = r.split(/\s+/).filter(Boolean).length
        return n > check.words ? [`reply ${i + 1} is ${n} words (max ${check.words})`] : []
      })
    case 'lead_has': {
      const v = t.lead[check.field]
      if (v === undefined) return [`lead.${String(check.field)} not saved`]
      if (check.value !== undefined && v !== check.value) return [`lead.${String(check.field)} = ${JSON.stringify(v)}, expected ${JSON.stringify(check.value)}`]
      return []
    }
    case 'no_unbacked_demo_promise': {
      if (t.toolEvents.some((e) => e.call.name === 'request_demo' && e.accepted)) return []
      const promise = replies.find((r) => DEMO_PROMISE.test(r))
      return promise ? [`promised a demo/contact without request_demo: "${promise.slice(0, 80)}…"`] : []
    }
    case 'lead_missing':
      return t.lead[check.field] === undefined ? [] : [`lead.${String(check.field)} should not be set (got ${JSON.stringify(t.lead[check.field])})`]
  }
}

/** Checks every scenario gets on top of its own: no made-up numbers, no promises the tools didn't back, no runaway tool loops, no empty replies. */
export const UNIVERSAL_CHECKS: Check[] = [
  { kind: 'no_invented_figures' },
  { kind: 'no_unbacked_demo_promise' },
  { kind: 'max_words', words: 120 },
]

export function scoreTranscript(checks: Check[], t: Transcript): string[] {
  const failures = [...UNIVERSAL_CHECKS, ...checks].flatMap((c) => runCheck(c, t))
  if (t.exhaustedTurns) failures.push(`${t.exhaustedTurns} turn(s) hit the tool-step cap without a reply`)
  const empty = t.replies.filter((r) => !r.trim()).length
  if (empty) failures.push(`${empty} empty reply(ies)`)
  return failures
}
