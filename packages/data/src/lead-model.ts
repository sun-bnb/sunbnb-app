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
