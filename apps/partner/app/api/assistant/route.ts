/**
 * POST /api/assistant — one turn of the partner AI assistant, streamed as server-sent events
 * (track 030 S2). GET /api/assistant?siteId=… — the render-friendly transcript.
 *
 * Gate order (cheapest first, nothing spent before it passes): kill switch → session (401) →
 * body shape (400) → feature flag `assistant` (403) → site ownership (403, sudo ok) → AI-turn limits
 * (429 / 503) → conversation (account + site scoped) → model loop → persist → `done`.
 *
 * `siteId` is bound HERE from the authenticated request and handed to every tool; the model never
 * supplies it. S2 tools are read-only; S3 adds proposal-only write tools (they store an
 * `AssistantAction` and emit a `proposal` event; applying is a separate, re-authorised server action).
 *
 * `attachments` (upload ids from uploadAssistantFile, max 5) are verified account-scoped + same-site and attached
 * to the user turn as content blocks (PDF/image) or quoted text (DOCX); only names are stored in the transcript.
 *
 * SSE events: `conversation`, `text`, `tool_start`, `tool_result`, `proposal` {actionId, kind, summary,
 * preview: Diff (+ `geometry` for inventory proposals)}, `qr_print` {parcel?: number, seatLabels?: string[]
 * (stored labels), seatIds?: string[] (display "1-2-3-1")} -- emitted by `request_qr_print`: the client
 * opens its existing QR print flow for that target (nothing is printed server-side), `align_photo`
 * (`AlignPhotoEvent` {uploadId, seed: Georef, image: {w, h}} from `request_photo_alignment`, track 030 S7:
 * the client opens the aerial-photo alignment overlay), `done`, `error`.
 * Tools also receive the sanitised page context (`ctx.pageContext`) to resolve `{ selection: true }`.
 */
import type { NextRequest } from 'next/server'
import { getLocale } from 'next-intl/server'
import { createClaudeModel } from '@repo/agent/claude-model'
import { runAgentLoop, type AgentEvent } from '@repo/agent/loop'
import type { ChatMessage } from '@repo/agent/model'
import { appendMessages, createConversation, getConversationForAccount, listProposalsForConversation } from '@repo/data/assistant'
import { getFlagStates } from '@repo/data/flags'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { assistantAvailable, assistantModelId, MAX_STEPS_PER_TURN, MAX_STORED_MESSAGES } from '@/lib/assistant/config'
import { renderPageContext } from '@/lib/assistant/context'
import { attachmentMeta, buildAttachmentContent, resolveAttachments } from '@/lib/assistant/attachments'
import { allowAssistantTurn, allowExtractionJob } from '@/lib/assistant/limits'
import { failure, ID, parseAssistantRequest, sse } from '@/lib/assistant/request'
import { buildSystemPrompt } from '@/lib/assistant/system-prompt'
import { getAssistantTools, toolLabel, type AssistantToolCtx } from '@/lib/assistant/tools'
import { proposalLookup, toChatMessages, toRenderMessages, userContent } from '@/lib/assistant/transcript'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A turn is up to MAX_STEPS_PER_TURN model calls plus read-only tool queries.
export const maxDuration = 60

type Session = { user: { id: string } }

/** Cheapest check first: a signed-in user. */
async function authenticate(): Promise<Session | null> {
  const session = await auth()
  return session?.user?.id ? (session as Session) : null
}

type Gate = { ok: false; response: Response } | { ok: true; ownerId: string }

/** Flag → ownership. Shared by GET and POST so the transcript is gated exactly like a turn. */
async function authorizeSite(session: Session, siteId: string): Promise<Gate> {
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { sudo: true } })
  const flags = await getFlagStates({ isSudo: !!user?.sudo, accountId: session.user.id })
  if (!flags.assistant?.enabled) return { ok: false, response: failure('forbidden', 'Assistant is not enabled for this account') }

  const { error } = await requireSiteOwner(siteId)
  if (error) return { ok: false, response: failure(error === 'Not authenticated' ? 'unauthenticated' : 'forbidden', error) }

  // Conversations belong to the account that OWNS the site (a sudo viewing it sees the owner's).
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return { ok: false, response: failure('forbidden', 'Not authorized') }
  return { ok: true, ownerId: site.userId }
}

export async function POST(request: NextRequest) {
  if (!assistantAvailable()) return failure('unavailable', 'Assistant is unavailable')

  const session = await authenticate()
  if (!session) return failure('unauthenticated', 'Not authenticated')

  const req = parseAssistantRequest(await request.json().catch(() => null))
  if (!req) return failure('bad_request', 'Invalid request')

  const gate = await authorizeSite(session, req.siteId)
  if (!gate.ok) return gate.response
  const { ownerId } = gate

  // Attachments: account-scoped + site-matched BEFORE anything is spent (a foreign id = 403).
  let attached: Awaited<ReturnType<typeof buildAttachmentContent>> = { media: [], textBlock: '' }
  let attachedMeta: ReturnType<typeof attachmentMeta> = []
  if (req.attachments.length) {
    const resolved = await resolveAttachments(req.attachments, ownerId, req.siteId)
    if (!resolved.ok) return resolved.reason === 'forbidden' ? failure('forbidden', 'Not authorized') : failure('bad_request', 'Too many or too large attachments')
    try {
      attached = await buildAttachmentContent(resolved.uploads)
    } catch (err) {
      console.error('[partner] assistant attachment read failed', err)
      return failure('bad_request', 'An attachment could not be read')
    }
    attachedMeta = attachmentMeta(resolved.uploads)
  }

  // After every cheap rejection, so malformed or foreign requests never spend the shared budget.
  const decision = await allowAssistantTurn(session.user.id)
  if (decision === 'rate_limited') return failure('rate_limited', 'Too many requests, slow down')
  if (decision === 'budget') return failure('budget', 'Assistant budget reached for today')
  if (req.attachments.length && !(await allowExtractionJob(session.user.id))) return failure('rate_limited', 'Too many document extractions today')

  let conversation
  if (req.conversationId) {
    conversation = await getConversationForAccount(req.conversationId, ownerId)
    // Missing, another account's and another site's conversation all look the same.
    if (!conversation || conversation.siteId !== req.siteId) return failure('forbidden', 'Not authorized')
  } else {
    conversation = await createConversation({ accountId: ownerId, siteId: req.siteId, title: req.message.slice(0, 80) })
  }
  const history = toChatMessages(conversation.messages)
  if (history.length >= MAX_STORED_MESSAGES) return failure('bad_request', 'Conversation is full; start a new one')

  const conversationId = conversation.id
  const locale = await getLocale().catch(() => 'en')
  const pageContext = await renderPageContext(req.context, req.siteId, attachedMeta)
  const text = userContent(req.message, pageContext)
  // The stored message carries text + attachment names only; the bytes / DOCX text ride this turn alone.
  const userMessage: ChatMessage = { role: 'user', content: text }
  const modelUserMessage: ChatMessage = {
    role: 'user',
    content: attached.textBlock ? `${text}\n\n${attached.textBlock}` : text,
    ...(attached.media.length ? { media: attached.media } : {}),
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(sse(event, data))
        } catch {
          closed = true
        }
      }
      send('conversation', { conversationId })
      // Write tools attach proposals to this conversation and push the `proposal` card event mid-turn.
      // Tokens tools spend on their own model calls (plan extraction) join the conversation's usage.
      const toolUsage = { inputTokens: 0, outputTokens: 0 }
      const ctx: AssistantToolCtx = {
        session, accountId: ownerId, siteId: req.siteId, locale, conversationId, emit: send, pageContext: req.context,
        recordUsage: (u) => { toolUsage.inputTokens += u.inputTokens; toolUsage.outputTokens += u.outputTokens },
      }

      const onEvent = (event: AgentEvent) => {
        if (event.type === 'text_delta') send('text', { delta: event.text })
        else if (event.type === 'tool_start') send('tool_start', { name: event.name, label: toolLabel(event.name) })
        else if (event.type === 'tool_result') {
          const result = event.execution.result as { ok?: unknown } | undefined
          const ok = event.execution.accepted && result?.ok !== false
          send('tool_result', { name: event.execution.call.name, ok })
        }
      }

      try {
        const result = await runAgentLoop({
          model: createClaudeModel({ model: assistantModelId(), maxTokens: 4096 }),
          system: buildSystemPrompt(),
          messages: [...history, modelUserMessage],
          tools: getAssistantTools(),
          ctx,
          maxSteps: MAX_STEPS_PER_TURN,
          onEvent,
          signal: request.signal,
        })
        if (!result.reply && !result.exhausted) {
          send('error', { code: 'unavailable', message: 'The assistant could not answer that' })
        } else {
          const saved = await appendMessages(
            conversationId,
            ownerId,
            [attachedMeta.length ? { ...userMessage, attachments: attachedMeta } : userMessage, ...result.messages] as unknown as Parameters<typeof appendMessages>[2],
            { inputTokens: result.usage.promptTokens + toolUsage.inputTokens, outputTokens: result.usage.completionTokens + toolUsage.outputTokens },
          )
          if (!saved) send('error', { code: 'unavailable', message: 'Could not save the conversation' })
          else send('done', { conversationId })
        }
      } catch (err) {
        if (!request.signal.aborted) console.error('[partner] assistant turn failed', err)
        send('error', { code: 'unavailable', message: 'The assistant is unavailable right now' })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          /* client already gone */
        }
      }
    },
    cancel() {
      /* the loop observes request.signal */
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}

export async function GET(request: NextRequest) {
  if (!assistantAvailable()) return failure('unavailable', 'Assistant is unavailable')

  const session = await authenticate()
  if (!session) return failure('unauthenticated', 'Not authenticated')

  const siteId = request.nextUrl.searchParams.get('siteId') ?? ''
  const conversationId = request.nextUrl.searchParams.get('conversationId')
  if (!ID.test(siteId) || (conversationId !== null && !ID.test(conversationId))) return failure('bad_request', 'Invalid request')

  const gate = await authorizeSite(session, siteId)
  if (!gate.ok) return gate.response

  const conversation = conversationId
    ? await getConversationForAccount(conversationId, gate.ownerId)
    : await prisma.assistantConversation.findFirst({
        where: { accountId: gate.ownerId, siteId },
        orderBy: { updatedAt: 'desc' },
      })
  if (conversationId && (!conversation || conversation.siteId !== siteId)) return failure('forbidden', 'Not authorized')
  if (!conversation) return Response.json({ conversationId: null, messages: [] })
  const proposals = await listProposalsForConversation(conversation.id, gate.ownerId)
  return Response.json({
    conversationId: conversation.id,
    messages: toRenderMessages(conversation.messages, proposalLookup(proposals)),
  })
}
