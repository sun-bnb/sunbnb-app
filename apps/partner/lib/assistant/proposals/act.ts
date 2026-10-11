/**
 * Act immediately (track 030, D2 superseded 2026-10-11 by the founder: "just do what is asked").
 *
 * A write tool no longer waits for a click: it stores the `AssistantAction`, applies it in the same
 * tool call through the SAME `applyProposal` the card's Apply button uses (re-authorisation, stale
 * check, snapshot, execute, rollback on failure) and emits the card as already applied, with Undo.
 * Not a parallel write path.
 *
 * Exceptions that stay proposals: anything whose diff DELETES seats / parcels / elements / items
 * (deletes are not undoable, so they keep the typed confirmation), and everything past the per-turn
 * cap (the model stops and reports).
 */
import { createProposalFor, type ProposalCard, type ProposeCtx } from './create'
import { applyProposal } from './lifecycle'
import type { KindHandler } from './types'

/** A turn may apply at most this many actions; the next write is refused and the model reports. */
export const MAX_ACTIONS_PER_TURN = 5

export type ActOutcome =
  | { ok: true; applied: true; card: ProposalCard; appliedAt: number }
  | { ok: true; applied: false; card: ProposalCard } // a delete: waiting for the typed confirmation
  | { ok: false; error: string }

export const TURN_LIMIT_ERROR = `Action limit reached: at most ${MAX_ACTIONS_PER_TURN} changes are applied per message. Nothing more was changed; tell the user what was done and ask them to send a follow-up for the rest.`

export async function createAndApply<P>(
  ctx: ProposeCtx,
  handler: KindHandler<P, unknown>,
  payload: P,
  extraWarnings: string[] = [],
): Promise<ActOutcome> {
  if ((ctx.applied ?? 0) >= MAX_ACTIONS_PER_TURN) return { ok: false, error: TURN_LIMIT_ERROR }

  // Hold the card back until we know whether it was applied.
  const created = await createProposalFor(ctx, handler, payload, extraWarnings, { emit: false })
  if (!created.ok) return created
  const { card } = created

  if (card.preview.deletes?.length) {
    ctx.emit?.('proposal', card)
    return { ok: true, applied: false, card }
  }

  const res = await applyProposal(card.actionId, { note: false })
  if (res.status !== 'ok') {
    const [code, detail] = res.errors
    return { ok: false, error: detail ? `${code}: ${detail}` : (code ?? 'apply_failed') }
  }
  ctx.applied = (ctx.applied ?? 0) + 1
  const appliedAt = Date.now()
  ctx.emit?.('proposal', { ...card, summary: res.summary || card.summary, status: 'applied', appliedAt })
  return { ok: true, applied: true, card, appliedAt }
}
