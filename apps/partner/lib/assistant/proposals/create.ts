/**
 * Turning a validated payload into a stored, reviewable proposal (track 030 S3). The only thing a
 * write tool does: diff against the current state, persist `AssistantAction(status=proposed)`, tell
 * the UI. It never mutates site data.
 */
import { createProposal } from '@repo/data/assistant'
import { isEmptyDiff, ProposalError, summarizeDiff, type Diff, type KindHandler } from './types'

export interface ProposeCtx {
  session: unknown
  accountId: string
  siteId: string
  conversationId?: string
  emit?: (event: string, data: unknown) => void
  /** Actions applied so far this turn (mutated by `createAndApply`; capped at MAX_ACTIONS_PER_TURN). */
  applied?: number
}

export interface ProposalCard {
  actionId: string
  kind: string
  summary: string
  preview: Diff
}

type Json = Parameters<typeof createProposal>[0]['payload']

/** The shape stored in `AssistantAction.preview`: the Diff plus the one-line summary. */
export function storedPreview(summary: string, diff: Diff): Json {
  return JSON.parse(JSON.stringify({ summary, ...diff })) as Json
}

/** Inverse of `storedPreview`. */
export function readPreview(stored: unknown): { summary: string; preview: Diff } {
  const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const { summary, ...rest } = o
  return {
    summary: typeof summary === 'string' ? summary : '',
    preview: { changes: [], ...(rest as Partial<Diff>) },
  }
}

export function readPayload<P>(stored: unknown): P {
  return ((stored as { data?: P } | null)?.data ?? stored) as P
}

export async function createProposalFor<P>(
  ctx: ProposeCtx,
  handler: KindHandler<P, unknown>,
  payload: P,
  extraWarnings: string[] = [],
  opts: { emit?: boolean } = {},
): Promise<{ ok: true; card: ProposalCard } | { ok: false; error: string }> {
  if (!ctx.conversationId) return { ok: false, error: 'no_conversation' }

  let diff: Diff
  try {
    diff = await handler.diff({ siteId: ctx.siteId, accountId: ctx.accountId }, payload)
  } catch (err) {
    if (err instanceof ProposalError) return { ok: false, error: err.message }
    throw err
  }
  if (isEmptyDiff(diff)) return { ok: false, error: 'Nothing would change: the current values already match' }
  if (extraWarnings.length) diff = { ...diff, warnings: [...(diff.warnings ?? []), ...extraWarnings] }

  const summary = summarizeDiff(diff)
  const user = (ctx.session as { user?: { id?: string; impersonatorId?: string } } | null)?.user
  const row = await createProposal({
    conversationId: ctx.conversationId,
    accountId: ctx.accountId,
    siteId: ctx.siteId,
    kind: handler.kind,
    payload: { v: 1, data: payload } as unknown as Json,
    preview: storedPreview(summary, diff),
    actorUserId: user?.id ?? ctx.accountId,
    impersonatorId: user?.impersonatorId ?? null,
  })
  if (!row) return { ok: false, error: 'conversation_not_found' }

  const card: ProposalCard = { actionId: row.id, kind: handler.kind, summary, preview: diff }
  if (opts.emit !== false) ctx.emit?.('proposal', card)
  return { ok: true, card }
}
