/**
 * Where one tracking call goes (track 027 P8 + tracking setup) — pure, so the routing rules are
 * tested without a browser. `lib/track.ts` executes the plan; the tags only exist after marketing
 * consent (`lib/marketing-tags.ts`), so a plan is harmless before it.
 *
 * Destinations:
 *  - first-party beacon (/api/events): every FUNNEL event, consent or not — cookieless counts;
 *  - Meta Pixel: conversions as standard events (with the eventID server-side conversions will
 *    de-duplicate against), every other funnel event as a custom event;
 *  - Google: every event to GA4 (when configured), conversions also to their Google Ads action;
 *  - PostHog: every event, with the page's tracking context.
 * Analytics-only events (web vitals) skip the beacon and Meta: they are measurements, not funnel.
 */
import type { LeadEventName } from '@repo/data/lead-model'

export type Props = Record<string, string | number | boolean>
export interface TrackingContext {
  token?: string
  angle?: string | null
  variant?: string | null
}
export interface TagConfig {
  googleAdsId?: string
  ga4Id?: string
  adsLabels: { mockup?: string; lead?: string; signup?: string }
}
export type AnalyticsEventName = 'web_vital'

/** Ad-platform conversions: Meta standard events and Google Ads conversion actions. */
export const CONVERSIONS: Partial<Record<LeadEventName, { meta: string; google: keyof TagConfig['adsLabels'] }>> = {
  mockup_created: { meta: 'ViewContent', google: 'mockup' },
  demo_requested: { meta: 'Lead', google: 'lead' },
  signup_done: { meta: 'CompleteRegistration', google: 'signup' },
  claim_done: { meta: 'CompleteRegistration', google: 'signup' },
}

export interface TrackingPlan {
  beacon: boolean
  fbq: unknown[][]
  gtag: unknown[][]
  posthog: { event: string; properties: Props }
}

export function planEvent(
  name: LeadEventName | AnalyticsEventName,
  props: Props | undefined,
  ctx: TrackingContext,
  cfg: TagConfig,
  opts: { beacon?: boolean } = {},
): TrackingPlan {
  const funnel = name !== 'web_vital'
  const conv = funnel ? CONVERSIONS[name as LeadEventName] : undefined
  // The token only goes to PostHog (our own analytics); ad platforms and GA4 get the arm and angle.
  const labels: Props = {}
  if (ctx.angle) labels.angle = ctx.angle
  if (ctx.variant) labels.variant = ctx.variant

  const fbq: unknown[][] = []
  const gtag: unknown[][] = []
  if (conv) {
    const eventId = `${ctx.token ?? 'anon'}:${name}`
    fbq.push(['track', conv.meta, {}, { eventID: eventId }])
    const label = cfg.adsLabels[conv.google]
    if (cfg.googleAdsId && label) gtag.push(['event', 'conversion', { send_to: `${cfg.googleAdsId}/${label}`, transaction_id: eventId }])
  } else if (funnel) {
    fbq.push(['trackCustom', name, { ...props }])
  }
  if (cfg.ga4Id) gtag.unshift(['event', name, { ...props, ...labels, send_to: cfg.ga4Id }])

  return {
    beacon: funnel && opts.beacon !== false,
    fbq,
    gtag,
    posthog: { event: name, properties: { ...props, ...labels, ...(ctx.token ? { token: ctx.token } : {}) } },
  }
}

/** Scroll-depth marks reached at `fraction` of the page that haven't been sent yet. */
export const SCROLL_MARKS = [25, 50, 75, 100] as const
export function newScrollMarks(fraction: number, sent: ReadonlySet<number>): number[] {
  const pct = fraction * 100
  // 100 % = within a few pixels of the end; float rounding never reaches it exactly.
  return SCROLL_MARKS.filter((m) => !sent.has(m) && (m === 100 ? pct >= 99 : pct >= m))
}
