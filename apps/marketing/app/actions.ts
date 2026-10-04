'use server'

/**
 * Public server actions for try.sunbnb.app (track 027 P3). Anyone on the internet can call these,
 * so every input is re-validated here and each action is rate-limited per IP — the client-side
 * checks are a convenience, not a guard.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { rateLimit } from '@repo/data/rate-limit'
import { parseLeadLayout, LEAD_TOKEN_RE } from '@repo/data/lead-model'
import { createLeadMockup, requestLeadDemo, saveLeadLayout } from '@repo/data/leads'
import { sendEmail } from '@repo/data/email'
import { fetchBeachPlace } from '@/lib/place-details.ts'
import { clientIp, isValidPlaceId, isValidSessionToken, localeOrDefault, parseSunbedCount } from '@/lib/places.ts'
import { CONSENT_VERSION, looksAutomated, parseDemoRequest, type DemoRequestError } from '@/lib/demo-request.ts'

type ActionResult<E extends string = string> = { status: 'ok' } | { status: 'error'; errors: E[] }

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const

/** Beach form → anonymous lead → the shareable mockup page. */
export async function createMockup(form: FormData): Promise<ActionResult<'beach' | 'sunbeds' | 'rateLimited' | 'place'>> {
  const ip = clientIp(headers())
  if (!rateLimit(`mockup:${ip}`, { maxAttempts: 20, windowMs: 60 * 60_000 }).allowed) {
    return { status: 'error', errors: ['rateLimited'] }
  }

  const placeId = form.get('place')
  const sunbedCount = parseSunbedCount(form.get('beds') as string | null)
  if (typeof placeId !== 'string' || !isValidPlaceId(placeId)) return { status: 'error', errors: ['beach'] }
  if (sunbedCount === null) return { status: 'error', errors: ['sunbeds'] }

  const session = form.get('session')
  const locale = localeOrDefault(await getLocale())
  const place = await fetchBeachPlace(placeId, {
    session: typeof session === 'string' && isValidSessionToken(session) ? session : undefined,
    lang: locale,
  })
  if (!place) return { status: 'error', errors: ['place'] }

  const utm: Partial<Record<(typeof UTM_KEYS)[number], string>> = {}
  for (const k of UTM_KEYS) {
    const v = form.get(`utm_${k}`)
    if (typeof v === 'string' && v) utm[k] = v
  }

  const { token } = await createLeadMockup({
    placeId: place.placeId,
    beachName: place.name,
    beachAddress: place.address,
    lat: place.lat,
    lng: place.lng,
    sunbedCount,
    locale,
    utm,
  })
  redirect(`/m/${token}`)
}

/** Persist the prospect's layout (rotation, position, shore snap) so the shared link matches. */
export async function saveLayout(token: string, layout: unknown): Promise<ActionResult<'invalid' | 'rateLimited'>> {
  if (!rateLimit(`layout:${clientIp(headers())}`, { maxAttempts: 120, windowMs: 60 * 60_000 }).allowed) {
    return { status: 'error', errors: ['rateLimited'] }
  }
  const parsed = parseLeadLayout(layout)
  if (!LEAD_TOKEN_RE.test(token) || !parsed) return { status: 'error', errors: ['invalid'] }
  return (await saveLeadLayout(token, parsed)) ? { status: 'ok' } : { status: 'error', errors: ['invalid'] }
}

const NOTIFY_TO = process.env.LEADS_NOTIFY_EMAIL || 'info@sunbnb.app'

/** "Book a demo" → contact + consent on the lead, and an email to the team on the first request. */
export async function requestDemo(token: string, form: FormData): Promise<ActionResult<DemoRequestError | 'rateLimited' | 'notFound'>> {
  const h = headers()
  if (!rateLimit(`demo:${clientIp(h)}`, { maxAttempts: 5, windowMs: 60 * 60_000 }).allowed) {
    return { status: 'error', errors: ['rateLimited'] }
  }
  if (!LEAD_TOKEN_RE.test(token)) return { status: 'error', errors: ['notFound'] }

  // A bot gets the same 'ok' a person does, and nothing is stored or sent.
  if (looksAutomated(form, Date.now())) return { status: 'ok' }

  const parsed = parseDemoRequest(form)
  if (!parsed.ok) return { status: 'error', errors: parsed.errors }

  const result = await requestLeadDemo(token, { ...parsed.value, consentVersion: CONSENT_VERSION })
  if (!result.ok) return { status: 'error', errors: ['notFound'] }

  if (result.firstRequest) {
    const host = h.get('host') ?? 'try.sunbnb.app'
    const v = parsed.value
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    const rows: [string, string | null][] = [
      ['Beach', `${result.lead.beachName} — ${result.lead.beachAddress}`],
      ['Sunbeds', String(result.lead.sunbedCount)],
      ['Name', v.contactName],
      ['Business', v.businessName],
      ['Email', v.email],
      ['Phone', v.phone],
      ['Message', v.message],
      ['Source', [result.lead.utmSource, result.lead.utmCampaign].filter(Boolean).join(' / ') || null],
    ]
    try {
      await sendEmail({
        to: NOTIFY_TO,
        subject: `Demo request: ${result.lead.beachName} (${result.lead.sunbedCount} sunbeds)`,
        html:
          `<table>${rows.filter(([, val]) => val).map(([k, val]) => `<tr><td><b>${k}</b></td><td>${esc(val!)}</td></tr>`).join('')}</table>` +
          `<p><a href="https://${esc(host)}/m/${token}">Open their mockup</a></p>`,
      })
    } catch (err) {
      // The lead is saved; a failed notification must not tell the prospect their request failed.
      console.error('[marketing] demo request notification failed', err)
    }
  }
  return { status: 'ok' }
}
