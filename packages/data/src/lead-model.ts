/**
 * Marketing lead rules (track 027) — pure, no prisma, so the marketing app's client code and the
 * unit tests can import it. The DB functions live in `./leads`.
 */

export const LEAD_STATUS = {
  MOCKUP: 'mockup',
  DEMO_REQUESTED: 'demo_requested',
  CONTACTED: 'contacted',
  CONVERTED: 'converted',
  CLOSED: 'closed',
} as const
export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS]

/**
 * Retention, stated in the try.sunbnb.app privacy notice (founder decision 2026-10-04):
 * a mockup nobody left contact details on is kept 90 days, a lead with contact 24 months —
 * both counted from the last activity, so an engaged prospect is not deleted mid-conversation.
 */
export const RETENTION_ANONYMOUS_DAYS = 90
export const RETENTION_CONTACT_MONTHS = 24

export function retentionCutoffs(now: Date): { anonymousBefore: Date; contactBefore: Date } {
  const anonymousBefore = new Date(now.getTime() - RETENTION_ANONYMOUS_DAYS * 24 * 60 * 60 * 1000)
  const contactBefore = new Date(now)
  contactBefore.setUTCMonth(contactBefore.getUTCMonth() - RETENTION_CONTACT_MONTHS)
  return { anonymousBefore, contactBefore }
}

/**
 * Mockup link token: 12 chars of an unambiguous alphabet (no 0/O/1/l/I) ≈ 67 bits — unguessable,
 * so a mockup link is only reachable by whoever received it, and short enough to read aloud.
 */
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const LEAD_TOKEN_LENGTH = 12
export const LEAD_TOKEN_RE = new RegExp(`^[${TOKEN_ALPHABET}]{${LEAD_TOKEN_LENGTH}}$`)

export function generateLeadToken(): string {
  // Rejection sampling: 256 is not a multiple of the alphabet size, so taking `byte % n` directly
  // would favour the first characters.
  const n = TOKEN_ALPHABET.length
  const limit = 256 - (256 % n)
  let out = ''
  while (out.length < LEAD_TOKEN_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(LEAD_TOKEN_LENGTH * 2))) {
      if (b < limit && out.length < LEAD_TOKEN_LENGTH) out += TOKEN_ALPHABET[b % n]
    }
  }
  return out
}

export const LEAD_PLACEMENTS = ['center', 'waterline'] as const
export type LeadPlacement = (typeof LEAD_PLACEMENTS)[number]

export interface LeadLayout {
  anchorLat: number
  anchorLng: number
  seaBearingDeg: number
  placement: LeadPlacement
}

/** A layout the client sent back — validated, because the save action is public. */
export function parseLeadLayout(raw: unknown): LeadLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const { anchorLat, anchorLng, seaBearingDeg, placement } = r
  if (typeof anchorLat !== 'number' || !Number.isFinite(anchorLat) || Math.abs(anchorLat) > 90) return null
  if (typeof anchorLng !== 'number' || !Number.isFinite(anchorLng) || Math.abs(anchorLng) > 180) return null
  if (typeof seaBearingDeg !== 'number' || !Number.isInteger(seaBearingDeg) || seaBearingDeg < 0 || seaBearingDeg >= 360) return null
  if (!LEAD_PLACEMENTS.includes(placement as LeadPlacement)) return null
  return { anchorLat, anchorLng, seaBearingDeg, placement: placement as LeadPlacement }
}

// ── Funnel tracking (track 027 P8) ──────────────────────────────────────────

/** A/B arms: 'a' = book a demo, 'b' = start free (D8). */
export const LEAD_VARIANTS = ['a', 'b'] as const
export type LeadVariant = (typeof LEAD_VARIANTS)[number]

/**
 * Sticky arm per lead, derived from its token: no cookie needed, and a shared mockup link keeps
 * its arm. `enabled` is the live set (env `MARKETING_VARIANTS`) — with one arm, everyone gets it.
 */
export function assignVariant(token: string, enabled: readonly LeadVariant[]): LeadVariant {
  const arms = enabled.length ? enabled : (['a'] as const)
  let h = 0
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0
  return arms[h % arms.length]!
}

export function parseVariants(raw: string | undefined | null): LeadVariant[] {
  const arms = (raw ?? 'a').split(',').map((s) => s.trim()).filter((s): s is LeadVariant => (LEAD_VARIANTS as readonly string[]).includes(s))
  return arms.length ? [...new Set(arms)] : ['a']
}

/** The ONLY event names /api/events accepts — free-form names would turn the table into a log of anything. */
export const LEAD_EVENT_NAMES = [
  'landing_view', 'search_start', 'beach_pick', 'mockup_created', 'beds_count_set', 'flown', 'beds_placed',
  'layout_adjusted', 'guest_demo_start', 'guest_demo_done', 'operator_checked_in', 'price_set',
  'projection_view', 'projection_finetune', 'projection_formula_open', 'brief_view', 'cta_view', 'cta_click',
  'link_emailed', 'demo_requested', 'signup_click', 'signup_done', 'claim_done', 'chat_open',
  'consent_marketing', 'consent_necessary',
] as const
export type LeadEventName = (typeof LEAD_EVENT_NAMES)[number]

export function isLeadEventName(v: unknown): v is LeadEventName {
  return typeof v === 'string' && (LEAD_EVENT_NAMES as readonly string[]).includes(v)
}

/** Ad angles the hero can speak to (`?a=`); anything else is stored as null. */
export const AD_ANGLES = ['noshow', 'cash', 'online', 'queue'] as const
export type AdAngle = (typeof AD_ANGLES)[number]
export function parseAngle(v: unknown): AdAngle | null {
  return typeof v === 'string' && (AD_ANGLES as readonly string[]).includes(v) ? (v as AdAngle) : null
}

/**
 * Event properties: a flat object of ≤ 12 short keys with string (≤ 64 chars) / number / boolean
 * values, ≤ 1 KB serialised. Anything else is rejected — properties carry funnel facts
 * (`{source:'vision', ms: 840}`), never visitor text.
 */
export function parseEventProps(raw: unknown): Record<string, string | number | boolean> | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > 12) return null
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of entries) {
    if (!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(k)) return null
    if (typeof v === 'string' && v.length <= 64) out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
    else return null
  }
  return JSON.stringify(out).length <= 1024 ? out : null
}

/** Ad click ids as Google / Meta issue them; anything else is not stored. */
export function parseClickId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_.-]{10,255}$/.test(v) ? v : null
}

// ── Qualifier (track 027 D10) ───────────────────────────────────────────────

/** What else a venue runs, as stored on the lead. 'none' = "just sunbeds". */
export const LEAD_RUNS = ['fnb', 'rentals', 'tables', 'none'] as const
export type LeadRun = (typeof LEAD_RUNS)[number]

/** "fnb,rentals" from a public form → validated, de-duplicated; 'none' only alone. */
export function parseLeadRuns(raw: unknown): LeadRun[] {
  if (typeof raw !== 'string' || raw.length > 60) return []
  const runs = [...new Set(raw.split(',').map((r) => r.trim()))].filter((r): r is LeadRun => (LEAD_RUNS as readonly string[]).includes(r))
  return runs.includes('none') ? (runs.length === 1 ? ['none'] : runs.filter((r) => r !== 'none')) : runs
}

// ── Lead score (track 027 P6) ───────────────────────────────────────────────

export interface LeadScoreInput {
  status: string
  sunbedCount: number
  hasContact: boolean
  runs: readonly string[]
  hasProjection: boolean
  chatTurns: number
  /** Names of the lead's funnel events (any order, repeats allowed). */
  events: readonly string[]
}

export interface LeadScore {
  /** 0–100: how far the prospect went, and how big the venue is. */
  score: number
  /** Why — one entry per point source, so the number is never a black box. */
  reasons: { label: string; points: number }[]
}

/**
 * Deterministic and explainable on purpose (no model): the team must be able to see why a lead
 * ranks where it does. Points for intent (demo request, contact), engagement (played the guest
 * booking / staff / numbers, used the chat) and size (sunbeds, extra services).
 */
export function scoreLead(l: LeadScoreInput): LeadScore {
  const reasons: LeadScore['reasons'] = []
  const add = (label: string, points: number, when: boolean) => when && reasons.push({ label, points })
  const ev = new Set(l.events)
  add('demo requested', 35, l.status !== LEAD_STATUS.MOCKUP || ev.has('demo_requested'))
  add('left contact details', 15, l.hasContact)
  add('booked as a guest', 8, ev.has('guest_demo_done'))
  add('checked a guest in', 6, ev.has('operator_checked_in'))
  add('looked at their numbers', 8, l.hasProjection || ev.has('projection_view'))
  add('used the AI chat', 6, l.chatTurns > 0)
  add('runs more than sunbeds', 6, l.runs.some((r) => r !== 'none'))
  add('100+ sunbeds', 16, l.sunbedCount >= 100)
  add('40–99 sunbeds', 10, l.sunbedCount >= 40 && l.sunbedCount < 100)
  add('under 40 sunbeds', 4, l.sunbedCount < 40)
  return { score: Math.min(100, reasons.reduce((s, r) => s + r.points, 0)), reasons }
}
