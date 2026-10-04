/**
 * Marketing leads (track 027) against real Postgres: the public mockup read must never carry
 * contact data, demo requests must not regress a status the team set, and retention must delete
 * exactly what the privacy notice says — no more, no less.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../index'
import { cleanDatabase } from './test/setup'
import { createLeadMockup, getLeadMockup, purgeExpiredLeads, requestLeadDemo, saveLeadLayout } from './leads'

beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect() })

const mockup = {
  placeId: 'ChIJJaa2PwAtlhIRpNc16H2XkAg',
  beachName: 'Platja de Muro - Dunes',
  beachAddress: 'Can Picafort, Spain',
  lat: 39.79,
  lng: 3.12,
  sunbedCount: 120,
  locale: 'es',
  utm: { source: 'google', campaign: 'spring' },
}

const demo = {
  contactName: 'Maria',
  email: 'maria@chiringuitosol.es',
  phone: null,
  businessName: 'Chiringuito Sol',
  message: null,
  consentVersion: '2026-10-04',
}

describe('createLeadMockup / getLeadMockup', () => {
  it('stores an anonymous mockup reachable by its token', async () => {
    const { token } = await createLeadMockup(mockup)
    const lead = await getLeadMockup(token)
    expect(lead).toMatchObject({ beachName: mockup.beachName, sunbedCount: 120, status: 'mockup', locale: 'es' })
    const row = await prisma.lead.findUniqueOrThrow({ where: { token } })
    expect(row.utmSource).toBe('google')
    expect(row.email).toBeNull()
  })

  it('NEVER returns contact fields on the public read, even after a demo request', async () => {
    const { token } = await createLeadMockup(mockup)
    await requestLeadDemo(token, demo)
    const lead = (await getLeadMockup(token)) as Record<string, unknown>
    for (const field of ['email', 'phone', 'contactName', 'businessName', 'message', 'utmSource']) {
      expect(lead).not.toHaveProperty(field)
    }
  })

  it('returns null for an unknown token', async () => {
    expect(await getLeadMockup('nope')).toBeNull()
  })
})

describe('saveLeadLayout', () => {
  it('persists the layout so a shared link shows the same beach', async () => {
    const { token } = await createLeadMockup(mockup)
    expect(await saveLeadLayout(token, { anchorLat: 39.78, anchorLng: 3.14, seaBearingDeg: 50, placement: 'waterline' })).toBe(true)
    expect(await getLeadMockup(token)).toMatchObject({ layoutSeaBearing: 50, layoutPlacement: 'waterline', layoutAnchorLat: 39.78 })
  })

  it('reports false for an unknown token instead of throwing', async () => {
    expect(await saveLeadLayout('nope', { anchorLat: 0, anchorLng: 0, seaBearingDeg: 0, placement: 'center' })).toBe(false)
  })
})

describe('requestLeadDemo', () => {
  it('records contact + consent and flags the first request', async () => {
    const { token } = await createLeadMockup(mockup)
    const r = await requestLeadDemo(token, demo)
    expect(r).toMatchObject({ ok: true, firstRequest: true, lead: { beachName: mockup.beachName, sunbedCount: 120 } })
    const row = await prisma.lead.findUniqueOrThrow({ where: { token } })
    expect(row.status).toBe('demo_requested')
    expect(row.consentVersion).toBe('2026-10-04')
    expect(row.consentAt).not.toBeNull()
    expect(row.demoRequestedAt).not.toBeNull()
  })

  it('a re-submission updates contact but is not a first request (no duplicate notification)', async () => {
    const { token } = await createLeadMockup(mockup)
    await requestLeadDemo(token, demo)
    const r = await requestLeadDemo(token, { ...demo, phone: '+34 600 123 456' })
    expect(r).toMatchObject({ ok: true, firstRequest: false })
    expect((await prisma.lead.findUniqueOrThrow({ where: { token } })).phone).toBe('+34 600 123 456')
  })

  it('never regresses a status the team has moved on', async () => {
    const { token } = await createLeadMockup(mockup)
    await requestLeadDemo(token, demo)
    await prisma.lead.update({ where: { token }, data: { status: 'contacted' } })
    await requestLeadDemo(token, demo)
    expect((await prisma.lead.findUniqueOrThrow({ where: { token } })).status).toBe('contacted')
  })

  it('fails cleanly for an unknown token', async () => {
    expect(await requestLeadDemo('nope', demo)).toEqual({ ok: false })
  })
})

describe('purgeExpiredLeads — exactly what the privacy notice promises', () => {
  const now = new Date('2026-10-04T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)

  async function lead(lastActivityAt: Date, withContact: boolean) {
    const { token } = await createLeadMockup(mockup)
    if (withContact) await requestLeadDemo(token, demo)
    await prisma.lead.update({ where: { token }, data: { lastActivityAt } })
    return token
  }

  it('deletes anonymous mockups idle > 90 days, keeps younger ones', async () => {
    const old = await lead(daysAgo(91), false)
    const young = await lead(daysAgo(89), false)
    expect(await purgeExpiredLeads(now)).toEqual({ anonymous: 1, contact: 0 })
    expect(await getLeadMockup(old)).toBeNull()
    expect(await getLeadMockup(young)).not.toBeNull()
  })

  it('keeps a lead WITH contact past 90 days, deletes it after 24 months', async () => {
    const kept = await lead(daysAgo(400), true)
    const expired = await lead(daysAgo(740), true)
    expect(await purgeExpiredLeads(now)).toEqual({ anonymous: 0, contact: 1 })
    expect(await getLeadMockup(kept)).not.toBeNull()
    expect(await getLeadMockup(expired)).toBeNull()
  })
})
