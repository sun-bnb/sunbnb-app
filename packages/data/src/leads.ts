/**
 * Marketing leads (track 027) — the only writers of the `lead` table. Pure rules (statuses,
 * retention, token format, layout validation) are in `./lead-model`.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../index'
import { assignVariant, generateLeadToken, LEAD_STATUS, retentionCutoffs, scoreLead, type LeadScore, type LeadStatus, type AdAngle, type LeadEventName, type LeadLayout, type LeadRun, type LeadVariant } from './lead-model'

export interface NewLeadMockup {
  placeId: string
  beachName: string
  beachAddress: string
  lat: number
  lng: number
  sunbedCount: number
  locale: string
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string>>
  /** Ad angle and click ids, already validated by the caller (`parseAngle` / `parseClickId`). */
  angle?: AdAngle | null
  gclid?: string | null
  fbclid?: string | null
  /** Live A/B arms; the lead's arm is derived from its token (sticky, no cookie). */
  variants?: readonly LeadVariant[]
  /** QA override (`?v=a|b`) — only honoured if that arm is live. */
  forceVariant?: LeadVariant | null
  /** The visitor had already accepted marketing cookies when the mockup was created. */
  marketingConsent?: boolean
  /** The qualifier answer (`parseLeadRuns`); empty = not answered. */
  runs?: LeadRun[]
}

const UTM_MAX = 200

export async function createLeadMockup(input: NewLeadMockup): Promise<{ token: string; variant: LeadVariant }> {
  const utm = (k: keyof NonNullable<NewLeadMockup['utm']>) => input.utm?.[k]?.slice(0, UTM_MAX) || null
  // A token collision is ~2^-67 per pair; retry once on the unique index rather than pre-checking.
  for (let attempt = 0; ; attempt++) {
    try {
      const token = generateLeadToken()
      const live = input.variants ?? ['a']
      const variant = input.forceVariant && live.includes(input.forceVariant) ? input.forceVariant : assignVariant(token, live)
      const lead = await prisma.lead.create({
        data: {
          token,
          variant,
          angle: input.angle ?? null,
          runs: input.runs ?? [],
          gclid: input.gclid ?? null,
          fbclid: input.fbclid ?? null,
          marketingConsentAt: input.marketingConsent ? new Date() : null,
          placeId: input.placeId,
          beachName: input.beachName.slice(0, 300),
          beachAddress: input.beachAddress.slice(0, 500),
          lat: input.lat,
          lng: input.lng,
          sunbedCount: input.sunbedCount,
          locale: input.locale,
          utmSource: utm('source'),
          utmMedium: utm('medium'),
          utmCampaign: utm('campaign'),
          utmTerm: utm('term'),
          utmContent: utm('content'),
        },
        select: { token: true, variant: true },
      })
      return { token: lead.token, variant: (lead.variant ?? 'a') as LeadVariant }
    } catch (err) {
      if (attempt < 2 && (err as { code?: string }).code === 'P2002') continue
      throw err
    }
  }
}

/**
 * What the PUBLIC mockup page may see. Anyone with the link can open it, so the contact fields
 * are deliberately not selected — not filtered later, never read at all.
 */
export async function getLeadMockup(token: string) {
  return prisma.lead.findUnique({
    where: { token },
    select: {
      token: true,
      placeId: true,
      beachName: true,
      runs: true,
      projection: true,
      beachAddress: true,
      lat: true,
      lng: true,
      sunbedCount: true,
      layoutAnchorLat: true,
      layoutAnchorLng: true,
      layoutSeaBearing: true,
      layoutPlacement: true,
      locale: true,
      status: true,
      variant: true,
      angle: true,
    },
  })
}

export type LeadMockup = NonNullable<Awaited<ReturnType<typeof getLeadMockup>>>

/** Persist the layout as the prospect left it, so the shared link shows the same beach. */
export async function saveLeadLayout(token: string, layout: LeadLayout): Promise<boolean> {
  const { count } = await prisma.lead.updateMany({
    where: { token },
    data: {
      layoutAnchorLat: layout.anchorLat,
      layoutAnchorLng: layout.anchorLng,
      layoutSeaBearing: layout.seaBearingDeg,
      layoutPlacement: layout.placement,
      lastActivityAt: new Date(),
    },
  })
  return count === 1
}

export interface DemoRequest {
  contactName: string
  email: string | null
  phone: string | null
  businessName: string | null
  message: string | null
  consentVersion: string
}

/**
 * Attach contact details + consent and mark the lead as wanting a demo. A later status set by the
 * team (contacted / converted / closed) is never regressed by a re-submission; `firstRequest`
 * tells the caller whether this is the transition worth notifying about.
 */
export async function requestLeadDemo(
  token: string,
  req: DemoRequest,
): Promise<{ ok: false } | { ok: true; firstRequest: boolean; lead: { id: string; locale: string; beachName: string; beachAddress: string; sunbedCount: number; runs: string[]; projection: Prisma.JsonValue; utmSource: string | null; utmCampaign: string | null } }> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.lead.findUnique({ where: { token }, select: { status: true } })
    if (!current) return { ok: false as const }
    const firstRequest = current.status === LEAD_STATUS.MOCKUP
    const now = new Date()
    const lead = await tx.lead.update({
      where: { token },
      data: {
        contactName: req.contactName,
        email: req.email,
        phone: req.phone,
        businessName: req.businessName,
        message: req.message,
        consentAt: now,
        consentVersion: req.consentVersion,
        lastActivityAt: now,
        ...(firstRequest ? { status: LEAD_STATUS.DEMO_REQUESTED, demoRequestedAt: now } : {}),
      },
      select: { id: true, locale: true, beachName: true, beachAddress: true, sunbedCount: true, runs: true, projection: true, utmSource: true, utmCampaign: true },
    })
    return { ok: true as const, firstRequest, lead }
  })
}

/** Retention sweep — run daily. Returns how many rows each rule removed. */
export async function purgeExpiredLeads(now = new Date()): Promise<{ anonymous: number; contact: number }> {
  const { anonymousBefore, contactBefore } = retentionCutoffs(now)
  const anonymous = await prisma.lead.deleteMany({
    where: { email: null, phone: null, contactName: null, lastActivityAt: { lt: anonymousBefore } },
  })
  const contact = await prisma.lead.deleteMany({ where: { lastActivityAt: { lt: contactBefore } } })
  // Lead-linked events go with their lead (FK cascade). Anonymous funnel counts carry no personal
  // data, but are still not kept forever.
  await prisma.leadEvent.deleteMany({ where: { leadId: null, createdAt: { lt: contactBefore } } })
  return { anonymous: anonymous.count, contact: contact.count }
}

// ── AI sales chat (track 027 P5) ────────────────────────────────────────────

/** Max prospect messages per lead, across all sessions — bounds what one link can spend. */
export const LEAD_CHAT_MAX_TURNS = 40

/**
 * Everything the chat route needs to continue a conversation. SERVER-ONLY: it carries contact
 * data, so it must never back a page render (that is what `getLeadMockup` is for).
 */
export async function getLeadChatContext(token: string, sessionId: string) {
  const lead = await prisma.lead.findUnique({
    where: { token },
    select: {
      status: true,
      beachName: true,
      runs: true,
      projection: true,
      sunbedCount: true,
      contactName: true,
      email: true,
      phone: true,
      businessName: true,
      businessType: true,
      chatTurns: true,
      chatSessions: true,
    },
  })
  if (!lead) return null
  const sessions = (lead.chatSessions as { sessions?: Record<string, unknown[]> } | null)?.sessions ?? {}
  const { chatSessions: _omit, ...rest } = lead
  return { ...rest, history: (sessions[sessionId] ?? []) as unknown[] }
}

export interface ChatTurnUpdate {
  sessionId: string
  /** The session's full message list after this turn (provider-neutral, opaque here). */
  messages: unknown[]
  contact: { contactName?: string; email?: string; phone?: string; businessName?: string; businessType?: string }
  sunbedCount?: number
  demoRequested: boolean
  consentVersion: string
}

/**
 * Persist one chat turn and its effects atomically. Contact details only ever ADD or replace —
 * the chat never blanks a field — and, as with the form, a status the team set is not regressed.
 */
export async function saveLeadChatTurn(token: string, u: ChatTurnUpdate) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.lead.findUnique({ where: { token }, select: { status: true, chatSessions: true } })
    if (!current) return { ok: false as const }
    const sessions = { ...((current.chatSessions as { sessions?: Record<string, unknown[]> } | null)?.sessions ?? {}) }
    sessions[u.sessionId] = u.messages
    const firstRequest = u.demoRequested && current.status === LEAD_STATUS.MOCKUP
    const hasContact = Boolean(u.contact.email || u.contact.phone)
    const now = new Date()
    const contact = Object.fromEntries(Object.entries(u.contact).filter(([, v]) => typeof v === 'string' && v.trim()))
    const lead = await tx.lead.update({
      where: { token },
      data: {
        chatSessions: { sessions } as object,
        chatTurns: { increment: 1 },
        lastActivityAt: now,
        ...contact,
        ...(u.sunbedCount ? { sunbedCount: u.sunbedCount } : {}),
        // Sharing contact in the chat is consent under the notice shown next to the chat input.
        ...(hasContact ? { consentAt: now, consentVersion: u.consentVersion } : {}),
        ...(firstRequest ? { status: LEAD_STATUS.DEMO_REQUESTED, demoRequestedAt: now } : {}),
      },
      select: {
        id: true, locale: true, beachName: true, beachAddress: true, sunbedCount: true, runs: true, projection: true, contactName: true, email: true, phone: true,
        businessName: true, utmSource: true, utmCampaign: true,
      },
    })
    return { ok: true as const, firstRequest, lead }
  })
}

// ── Funnel events & consent (track 027 P8) ──────────────────────────────────

/**
 * Record one funnel event. With a token the event is tied to that lead and takes the lead's own
 * variant/angle (the client can't relabel itself); without one it is an anonymous count. Inputs
 * are validated by the caller (`isLeadEventName`, `parseEventProps`, `parseAngle`).
 */
export async function recordLeadEvent(e: {
  name: LeadEventName
  token?: string | null
  props?: Record<string, string | number | boolean> | null
  variant?: LeadVariant | null
  angle?: AdAngle | null
}): Promise<boolean> {
  if (e.token) {
    const lead = await prisma.lead.findUnique({ where: { token: e.token }, select: { id: true, variant: true, angle: true } })
    if (!lead) return false
    await prisma.leadEvent.create({
      data: { leadId: lead.id, name: e.name, variant: lead.variant, angle: lead.angle, props: e.props ?? undefined },
    })
    return true
  }
  await prisma.leadEvent.create({ data: { name: e.name, variant: e.variant ?? null, angle: e.angle ?? null, props: e.props ?? undefined } })
  return true
}

/** The visitor accepted marketing cookies on this lead's page (first acceptance wins). */
export async function recordMarketingConsent(token: string): Promise<void> {
  await prisma.lead.updateMany({ where: { token, marketingConsentAt: null }, data: { marketingConsentAt: new Date() } })
}

/** Store the prospect's projection (already recomputed server-side from validated inputs). */
export async function saveLeadProjection(token: string, projection: Prisma.InputJsonValue): Promise<boolean> {
  const res = await prisma.lead.updateMany({ where: { token }, data: { projection, projectionAt: new Date() } })
  return res.count > 0
}

// ── Admin (track 027 P6) — sudo-gated in apps/admin; these return contact data ──────────────

const ADMIN_LIST_LIMIT = 200

export interface AdminLeadRow {
  id: string
  token: string
  status: string
  beachName: string
  beachAddress: string
  sunbedCount: number
  runs: string[]
  contactName: string | null
  email: string | null
  phone: string | null
  variant: string | null
  angle: string | null
  utmSource: string | null
  utmCampaign: string | null
  createdAt: Date
  lastActivityAt: Date
  demoRequestedAt: Date | null
  score: LeadScore
}

/**
 * Leads for the admin list, newest activity first, scored. `onlyContact` = leads that left a way
 * to reach them (the ones to work); `status` filters exactly.
 */
export async function listLeadsForAdmin(filter: { status?: string; onlyContact?: boolean; q?: string } = {}): Promise<AdminLeadRow[]> {
  const q = filter.q?.trim()
  const leads = await prisma.lead.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.onlyContact ? { OR: [{ email: { not: null } }, { phone: { not: null } }] } : {}),
      ...(q
        ? { AND: [{ OR: [{ beachName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }, { businessName: { contains: q, mode: 'insensitive' } }] }] }
        : {}),
    },
    orderBy: { lastActivityAt: 'desc' },
    take: ADMIN_LIST_LIMIT,
    select: {
      id: true, token: true, status: true, beachName: true, beachAddress: true, sunbedCount: true, runs: true,
      contactName: true, email: true, phone: true, variant: true, angle: true, utmSource: true, utmCampaign: true,
      createdAt: true, lastActivityAt: true, demoRequestedAt: true, projection: true, chatTurns: true,
      events: { select: { name: true } },
    },
  })
  return leads.map(({ events, projection, chatTurns, ...l }) => ({
    ...l,
    score: scoreLead({
      status: l.status,
      sunbedCount: l.sunbedCount,
      hasContact: Boolean(l.email || l.phone),
      runs: l.runs,
      hasProjection: projection !== null,
      chatTurns,
      events: events.map((e) => e.name),
    }),
  }))
}

/** One lead with everything the team needs before calling: contact, numbers, funnel, transcript. */
export async function getLeadForAdmin(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: 'asc' }, select: { name: true, props: true, createdAt: true } } },
  })
  if (!lead) return null
  const score = scoreLead({
    status: lead.status,
    sunbedCount: lead.sunbedCount,
    hasContact: Boolean(lead.email || lead.phone),
    runs: lead.runs,
    hasProjection: lead.projection !== null,
    chatTurns: lead.chatTurns,
    events: lead.events.map((e) => e.name),
  })
  return { ...lead, score }
}

const ADMIN_SETTABLE: readonly LeadStatus[] = [LEAD_STATUS.DEMO_REQUESTED, LEAD_STATUS.CONTACTED, LEAD_STATUS.CONVERTED, LEAD_STATUS.CLOSED]

/** The team moves a lead along its pipeline. Unknown statuses are refused. */
export async function setLeadStatus(id: string, status: string): Promise<boolean> {
  if (!(ADMIN_SETTABLE as readonly string[]).includes(status)) return false
  const res = await prisma.lead.updateMany({ where: { id }, data: { status } })
  return res.count > 0
}
