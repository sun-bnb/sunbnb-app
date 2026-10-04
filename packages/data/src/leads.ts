/**
 * Marketing leads (track 027) — the only writers of the `lead` table. Pure rules (statuses,
 * retention, token format, layout validation) are in `./lead-model`.
 */
import prisma from '../index'
import { generateLeadToken, LEAD_STATUS, retentionCutoffs, type LeadLayout } from './lead-model'

export interface NewLeadMockup {
  placeId: string
  beachName: string
  beachAddress: string
  lat: number
  lng: number
  sunbedCount: number
  locale: string
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string>>
}

const UTM_MAX = 200

export async function createLeadMockup(input: NewLeadMockup): Promise<{ token: string }> {
  const utm = (k: keyof NonNullable<NewLeadMockup['utm']>) => input.utm?.[k]?.slice(0, UTM_MAX) || null
  // A token collision is ~2^-67 per pair; retry once on the unique index rather than pre-checking.
  for (let attempt = 0; ; attempt++) {
    try {
      const lead = await prisma.lead.create({
        data: {
          token: generateLeadToken(),
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
        select: { token: true },
      })
      return lead
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
): Promise<{ ok: false } | { ok: true; firstRequest: boolean; lead: { beachName: string; beachAddress: string; sunbedCount: number; utmSource: string | null; utmCampaign: string | null } }> {
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
      select: { beachName: true, beachAddress: true, sunbedCount: true, utmSource: true, utmCampaign: true },
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
  return { anonymous: anonymous.count, contact: contact.count }
}
