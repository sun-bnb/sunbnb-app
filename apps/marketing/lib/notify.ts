import 'server-only'
import { sendEmail } from '@repo/data/email'
import { getTranslations } from 'next-intl/server'
import { adminUrlFor } from './admin-url.ts'

const NOTIFY_TO = process.env.LEADS_NOTIFY_EMAIL || 'info@sunbnb.app'

/** The qualifier answer for the team (D10); null when the visitor didn't answer. */
function describeRuns(runs: string[] | undefined): string | null {
  if (!runs?.length) return null
  const name: Record<string, string> = { fnb: 'beach bar / food', rentals: 'rentals', tables: 'restaurant tables', none: 'just sunbeds' }
  return runs.map((r) => name[r] ?? r).join(', ')
}

/** The prospect's own estimate (P10) in one line for the team; null if they didn't look. */
function describeProjection(p: unknown): string | null {
  const proj = p as { input?: { price?: number; onlinePerDay?: number | null }; cheapest?: string | null } | null
  if (!proj?.input?.price) return null
  const parts = [`price €${proj.input.price}/sunbed-day`]
  if (proj.input.onlinePerDay != null) parts.push(`~${proj.input.onlinePerDay} sunbeds online/day (their estimate)`)
  if (proj.cheapest) parts.push(`cheapest plan: ${proj.cheapest}`)
  return parts.join(' · ')
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Email the team about a FIRST demo request, from the form or the chat. Never throws: the lead is
 * already saved, and a failed notification must not tell the prospect their request failed.
 */
export async function notifyDemoRequest(input: {
  token: string
  host: string
  via: 'form' | 'chat'
  lead: { id?: string; locale?: string; beachName: string; beachAddress: string; sunbedCount: number; runs?: string[]; projection?: unknown; utmSource: string | null; utmCampaign: string | null }
  contact: { contactName?: string | null; businessName?: string | null; email?: string | null; phone?: string | null; message?: string | null }
}): Promise<void> {
  const { lead, contact } = input
  const rows: [string, string | null | undefined][] = [
    ['Beach', `${lead.beachName} — ${lead.beachAddress}`],
    ['Sunbeds', String(lead.sunbedCount)],
    ['Also runs', describeRuns(lead.runs)],
    ['Their numbers', describeProjection(lead.projection)],
    ['Name', contact.contactName],
    ['Business', contact.businessName],
    ['Email', contact.email],
    ['Phone', contact.phone],
    ['Message', contact.message],
    ['Via', input.via === 'chat' ? 'AI chat (transcript stored on the lead)' : 'demo form'],
    ['Source', [lead.utmSource, lead.utmCampaign].filter(Boolean).join(' / ') || null],
  ]
  try {
    await sendEmail({
      to: NOTIFY_TO,
      subject: `Demo request: ${lead.beachName} (${lead.sunbedCount} sunbeds)`,
      html:
        `<table>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v!)}</td></tr>`).join('')}</table>` +
        `<p><a href="https://${esc(input.host)}/m/${input.token}">Open their mockup</a>` +
        (lead.id && adminUrlFor(input.host) ? ` · <a href="${adminUrlFor(input.host)}/leads/${encodeURIComponent(lead.id)}">Open the lead in admin</a> (score, funnel, chat)` : '') +
        `</p>`,
    })
  } catch (err) {
    console.error('[marketing] demo request notification failed', err)
  }
}

/**
 * The prospect's own link back to their beach, sent when they request a demo with an email (they
 * asked to be contacted; this is the reply, not marketing). In their page language. Never throws.
 */
export async function emailProspectTheirBeach(input: { to: string; host: string; token: string; locale: string; beachName: string; name?: string | null }): Promise<void> {
  try {
    const t = await getTranslations({ locale: input.locale, namespace: 'Email' })
    const link = `https://${input.host}/m/${input.token}`
    await sendEmail({
      to: input.to,
      subject: t('subject', { beach: input.beachName }),
      html:
        `<p>${esc(input.name ? t('hiName', { name: input.name }) : t('hi'))}</p>` +
        `<p>${esc(t('body', { beach: input.beachName }))}</p>` +
        `<p><a href="${esc(link)}">${esc(t('cta', { beach: input.beachName }))}</a></p>` +
        `<p>${esc(t('signoff'))}</p>`,
    })
  } catch (err) {
    console.error('[marketing] prospect email failed', err)
  }
}

/**
 * The global daily AI budget is used up (`lib/limits.ts`): the guide and the chat answer
 * "unavailable" until midnight UTC and the page carries on rule-based. Sent once per day. Never throws.
 */
export async function notifyAiBudgetReached(budget: number): Promise<void> {
  console.error(`[marketing] daily AI budget of ${budget} turns reached; AI off until 00:00 UTC`)
  try {
    await sendEmail({
      to: NOTIFY_TO,
      subject: `try.sunbnb.app: daily AI budget reached (${budget} turns)`,
      html:
        `<p>The assistant has answered ${budget} turns today, the daily cap. Until 00:00 UTC it is off; ` +
        `the page keeps working without it.</p>` +
        `<p>If this is real traffic, raise <code>MARKETING_AI_DAILY_TURNS</code> in Vercel. If it is not, ` +
        `this cap just did its job — check the Anthropic usage console.</p>`,
    })
  } catch (err) {
    console.error('[marketing] AI budget notification failed', err)
  }
}
