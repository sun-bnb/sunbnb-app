/**
 * POST /api/chat — one turn of the AI sales chat on the mockup page (track 027 P5).
 *
 * Body: { token, sessionId, message }. The conversation lives on the lead, one session per page
 * visit; the client only ever sends the NEW message, so it cannot rewrite history. Contact the
 * prospect types is captured and the demo booked by the server (contact-capture.ts) — the model
 * talks, the server acts. Every failure answers `{ status: 'unavailable' }` and the page keeps
 * working: the demo form never depends on this route (D1: the funnel survives the model being down).
 */
import type { NextRequest } from 'next/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { rateLimit } from '@repo/data/rate-limit'
import { getLeadChatContext, LEAD_CHAT_MAX_TURNS, recordLeadEvent, saveLeadChatTurn } from '@repo/data/leads'
import { createClaudeModel } from '@/lib/agent/claude-model.ts'
import type { ChatMessage } from '@/lib/agent/model.ts'
import { runTurn } from '@/lib/agent/run-turn.ts'
import { buildSystemPrompt } from '@/lib/agent/system-prompt.ts'
import { leadStateFromRow, parseChatRequest, turnEffects } from '@/lib/chat-request.ts'
import { CONSENT_VERSION } from '@/lib/demo-request.ts'
import { emailProspectTheirBeach, notifyDemoRequest } from '@/lib/notify.ts'
import { clientIp } from '@/lib/places.ts'

export const dynamic = 'force-dynamic'
// A turn is up to MAX_STEPS_PER_TURN model calls; Haiku answers in ~1–2 s each.
export const maxDuration = 30

/** D7: Claude Haiku 4.5. Overridable per environment without a deploy of code. */
const MODEL = process.env.LEAD_AGENT_MODEL || 'claude-haiku-4-5'

const unavailable = (status = 503) => Response.json({ status: 'unavailable' }, { status })

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return unavailable()
  if (!rateLimit(`chat:${clientIp(request.headers)}`, { maxAttempts: 30, windowMs: 10 * 60_000 }).allowed) {
    return Response.json({ status: 'rate_limited' }, { status: 429 })
  }

  const req = parseChatRequest(await request.json().catch(() => null))
  if (!req) return Response.json({ status: 'invalid' }, { status: 400 })

  const ctx = await getLeadChatContext(req.token, req.sessionId)
  if (!ctx) return Response.json({ status: 'not_found' }, { status: 404 })
  if (ctx.chatTurns >= LEAD_CHAT_MAX_TURNS) return Response.json({ status: 'limit' }, { status: 429 })

  const before = leadStateFromRow(ctx)
  const history = ctx.history as ChatMessage[]
  const userMessage: ChatMessage = { role: 'user', content: req.message }
  const system: ChatMessage = { role: 'system', content: buildSystemPrompt({ beachName: ctx.beachName, sunbedCount: ctx.sunbedCount, runs: ctx.runs, projection: ctx.projection }) }

  let turn
  try {
    turn = await runTurn(createClaudeModel({ model: MODEL, maxTokens: 1024 }), [system, ...history, userMessage], before, { autoCapture: true })
  } catch (err) {
    console.error('[marketing] chat turn failed', err)
    return unavailable(502)
  }

  const effects = turnEffects(before, turn.lead)
  const saved = await saveLeadChatTurn(req.token, {
    sessionId: req.sessionId,
    messages: [...history, userMessage, ...turn.messages],
    contact: effects.contact,
    sunbedCount: effects.sunbedCount,
    demoRequested: effects.demoRequested,
    consentVersion: `chat-${CONSENT_VERSION}`,
  })
  if (!saved.ok) return Response.json({ status: 'not_found' }, { status: 404 })

  if (saved.firstRequest) {
    await recordLeadEvent({ name: 'demo_requested', token: req.token, props: { via: 'chat' } })
    await notifyDemoRequest({
      token: req.token,
      host: request.headers.get('host') ?? 'try.sunbnb.app',
      via: 'chat',
      lead: saved.lead,
      contact: saved.lead,
    })
    if (saved.lead.email) {
      await emailProspectTheirBeach({ to: saved.lead.email, host: request.headers.get('host') ?? 'try.sunbnb.app', token: req.token, locale: saved.lead.locale, beachName: saved.lead.beachName, name: saved.lead.contactName })
    }
  }

  const t = await getTranslations({ locale: await getLocale(), namespace: 'Chat' })
  return Response.json({
    status: 'ok',
    // A refusal or an empty turn must still read as a reply, not as a blank bubble.
    reply: turn.reply || t('fallbackReply'),
    sunbedCount: saved.lead.sunbedCount,
    demoRequested: Boolean(turn.lead.demoRequested),
  })
}
