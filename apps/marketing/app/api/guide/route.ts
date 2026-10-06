/**
 * POST /api/guide — one turn of the agent BEFORE a mockup exists (track 027 D11).
 *
 * Anonymous and stateless: nothing is stored, the client resends a capped history, and the model
 * can only steer the page (`lib/guide.ts`). Bounded per IP and per session; every failure answers
 * `{ status: 'unavailable' }` and the page carries on with its rules-based path.
 */
import type { NextRequest } from 'next/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { rateLimit } from '@repo/data/rate-limit'
import { createClaudeModel } from '@/lib/agent/claude-model.ts'
import { GUIDE_TOOLS, guideActions, guideMessages, parseGuideRequest } from '@/lib/guide.ts'
import { allowAiTurn } from '@/lib/limits.ts'
import { clientIp } from '@/lib/places.ts'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const MODEL = process.env.LEAD_AGENT_MODEL || 'claude-haiku-4-5'
/** A visitor who hasn't picked a beach after this many questions should use the demo, not the chat. */
const SESSION_MAX_TURNS = 12

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ status: 'unavailable' }, { status: 503 })
  const req = parseGuideRequest(await request.json().catch(() => null))
  if (!req) return Response.json({ status: 'invalid' }, { status: 400 })
  // The session cap is a nudge toward the demo, not protection (the client picks the id), so it
  // stays in memory; the IP limits and the global budget below are the protection.
  if (!rateLimit(`guide-s:${req.sessionId}`, { maxAttempts: SESSION_MAX_TURNS, windowMs: 60 * 60_000 }).allowed) {
    return Response.json({ status: 'limit' }, { status: 429 })
  }
  const gate = await allowAiTurn('guide', clientIp(request.headers))
  if (gate === 'rate_limited') return Response.json({ status: 'rate_limited' }, { status: 429 })
  if (gate === 'budget') return Response.json({ status: 'unavailable' }, { status: 503 })

  let result
  try {
    // One call, no tool round-trip: the tools only steer the page, so the client acts on them and
    // the visitor sees the effect instead of a second model call's latency.
    result = await createClaudeModel({ model: MODEL, maxTokens: 300 }).chat(guideMessages(req), GUIDE_TOOLS)
  } catch (err) {
    console.error('[marketing] guide turn failed', err)
    return Response.json({ status: 'unavailable' }, { status: 502 })
  }

  const actions = guideActions(result.toolCalls)
  const t = await getTranslations({ locale: await getLocale(), namespace: 'Chat' })
  return Response.json({
    status: 'ok',
    // A tool call without words still needs a line; the client words it per action.
    reply: result.content.trim() || (actions.length ? '' : t('fallbackReply')),
    actions,
  })
}
