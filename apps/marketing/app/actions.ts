'use server'

/**
 * Public server actions for try.sunbnb.app (track 027 P3). Anyone on the internet can call these,
 * so every input is re-validated here and each action is rate-limited per IP — the client-side
 * checks are a convenience, not a guard.
 */
import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { rateLimit } from '@repo/data/rate-limit'
import { parseAngle, parseClickId, parseLeadLayout, parseLeadRuns, parseVariants, LEAD_TOKEN_RE, LEAD_VARIANTS, type LeadVariant } from '@repo/data/lead-model'
import { createLeadMockup, recordLeadEvent, requestLeadDemo, saveLeadLayout, saveLeadProjection } from '@repo/data/leads'
import { parseProjectionInput, project } from '@/lib/projection.ts'
import { readConsentCookie } from '@/lib/consent.ts'
import { emailProspectTheirBeach, notifyDemoRequest } from '@/lib/notify.ts'
import { fetchBeachPlace } from '@/lib/place-details.ts'
import { clientIp, isValidPlaceId, isValidSessionToken, localeOrDefault, parseSunbedCount } from '@/lib/places.ts'
import { CONSENT_VERSION, looksAutomated, parseDemoRequest, type DemoRequestError } from '@/lib/demo-request.ts'

type ActionResult<E extends string = string> = { status: 'ok' } | { status: 'error'; errors: E[] }

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const

/**
 * "Build my beach" → anonymous lead. Returns the token instead of redirecting (D11): the visitor
 * stays in the same world and the page swaps its URL to `/m/<token>` without a reload.
 */
export async function createMockup(
  form: FormData,
): Promise<{ status: 'ok'; token: string; variant: string } | { status: 'error'; errors: ('beach' | 'sunbeds' | 'rateLimited' | 'place')[] }> {
  const h = headers()
  const ip = clientIp(h)
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

  const forced = form.get('v')
  const { token, variant } = await createLeadMockup({
    placeId: place.placeId,
    beachName: place.name,
    beachAddress: place.address,
    lat: place.lat,
    lng: place.lng,
    sunbedCount,
    locale,
    utm,
    angle: parseAngle(form.get('a')),
    gclid: parseClickId(form.get('gclid')),
    fbclid: parseClickId(form.get('fbclid')),
    // D8 A/B arms live per environment; one arm = no test.
    variants: parseVariants(process.env.MARKETING_VARIANTS),
    forceVariant: (LEAD_VARIANTS as readonly unknown[]).includes(forced) ? (forced as LeadVariant) : null,
    // Accepted on the landing page, before this lead existed.
    marketingConsent: readConsentCookie(h.get('cookie') ?? '')?.marketing === true,
    runs: parseLeadRuns(form.get('runs')),
  })
  // The layout the visitor built in the builder (turned to the sea, moved) — saved so their link
  // reopens exactly as they left it. Validated like any public input; ignored if absent/invalid.
  const layout = parseLeadLayout({
    anchorLat: Number(form.get('anchorLat')),
    anchorLng: Number(form.get('anchorLng')),
    seaBearingDeg: Number(form.get('seaBearingDeg')),
    placement: form.get('placement'),
  })
  // Keep a shore-snapped parcel, or one the visitor turned/moved by hand. An untouched unsnapped
  // one sits on the Places point (often a road) — not saving it lets the link retry the snap.
  if (layout && (layout.placement === 'waterline' || form.get('adjusted') === '1')) await saveLeadLayout(token, layout)
  // Recorded server-side so the funnel count is exact; the page fires the ad-platform pixel.
  await recordLeadEvent({ name: 'mockup_created', token })
  return { status: 'ok', token, variant }
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
    await recordLeadEvent({ name: 'demo_requested', token, props: { via: 'form' } })
    await notifyDemoRequest({
      token,
      host: h.get('host') ?? 'try.sunbnb.app',
      via: 'form',
      lead: result.lead,
      contact: parsed.value,
    })
    if (parsed.value.email) {
      await emailProspectTheirBeach({ to: parsed.value.email, host: h.get('host') ?? 'try.sunbnb.app', token: token, locale: result.lead.locale, beachName: result.lead.beachName, name: parsed.value.contactName })
    }
  }
  return { status: 'ok' }
}

/**
 * The prospect's numbers (P10): validated inputs, recomputed HERE from the plan catalogue (never
 * trusting a client-computed figure), stored on the lead for the team email and the chat.
 */
export async function saveProjection(token: string, input: unknown): Promise<ActionResult<'invalid' | 'rateLimited'>> {
  if (!rateLimit(`projection:${clientIp(headers())}`, { maxAttempts: 60, windowMs: 60 * 60_000 }).allowed) {
    return { status: 'error', errors: ['rateLimited'] }
  }
  const parsed = parseProjectionInput(input)
  if (!LEAD_TOKEN_RE.test(token) || !parsed) return { status: 'error', errors: ['invalid'] }
  const projection = project(parsed)
  const ok = await saveLeadProjection(token, JSON.parse(JSON.stringify(projection)))
  if (ok) await recordLeadEvent({ name: 'projection_view', token })
  return ok ? { status: 'ok' } : { status: 'error', errors: ['invalid'] }
}
