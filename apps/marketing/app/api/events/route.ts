/**
 * POST /api/events — first-party funnel events (track 027 P8). Sent with navigator.sendBeacon.
 *
 * Body: { name, token?, props?, angle?, variant? }. Names are allow-listed and props are small
 * flat facts (`parseEventProps`), never visitor text. With a token the event joins that lead and
 * takes the lead's own variant/angle; without one it is an anonymous count — no cookie involved.
 * Always answers 204 for well-formed input so a beacon never retries or leaks validation details.
 */
import type { NextRequest } from 'next/server'
import { allow } from '@/lib/limits.ts'
import { isLeadEventName, LEAD_TOKEN_RE, LEAD_VARIANTS, parseAngle, parseEventProps, type LeadVariant } from '@repo/data/lead-model'
import { recordLeadEvent, recordMarketingConsent } from '@repo/data/leads'
import { clientIp } from '@/lib/places.ts'

export async function POST(request: NextRequest) {
  if (!(await allow('events', clientIp(request.headers)))) {
    return new Response(null, { status: 429 })
  }
  // sendBeacon posts text/plain; accept either content type.
  const body = (await request.text().then((t) => JSON.parse(t) as unknown).catch(() => null)) as Record<string, unknown> | null
  if (!body || !isLeadEventName(body.name)) return new Response(null, { status: 400 })

  const props = parseEventProps(body.props)
  if (body.props !== undefined && props === null) return new Response(null, { status: 400 })
  const token = typeof body.token === 'string' && LEAD_TOKEN_RE.test(body.token) ? body.token : null
  const variant = (LEAD_VARIANTS as readonly unknown[]).includes(body.variant) ? (body.variant as LeadVariant) : null

  await recordLeadEvent({ name: body.name, token, props, variant, angle: parseAngle(body.angle) })
  if (token && body.name === 'consent_marketing') await recordMarketingConsent(token)
  return new Response(null, { status: 204 })
}
