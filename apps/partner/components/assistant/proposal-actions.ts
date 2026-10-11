'use client'

import { dispatch } from './assistant-store'
import { applyAssistantAction, rejectAssistantAction, undoAssistantAction } from './proposal-api'
import { imageTargetOf } from '@/lib/resync'
import { dispatchAssistantApplied } from './proposal-events'
import { statusAfterError, toErrorCode, type ProposalErrorCode, type ProposalStatus } from './proposal-model'

export type ProposalOp = 'apply' | 'reject' | 'undo'

export type ProposalOutcome =
  | { ok: true; summary?: string }
  | { ok: false; code: ProposalErrorCode }

const OK_STATUS: Record<ProposalOp, ProposalStatus> = {
  apply: 'applied',
  reject: 'rejected',
  undo: 'undone',
}

/** Runs one server action, then mirrors the result into the conversation store. */
export async function runProposalOp(
  siteId: string,
  op: ProposalOp,
  proposal: { actionId: string; kind: string; preview?: unknown },
): Promise<ProposalOutcome> {
  const fn = op === 'apply' ? applyAssistantAction : op === 'reject' ? rejectAssistantAction : undoAssistantAction
  let res: { status: 'ok' | 'error'; errors?: string[]; summary?: string }
  try {
    res = await fn(proposal.actionId)
  } catch {
    return { ok: false, code: 'unknown' }
  }
  if (res.status === 'ok') {
    dispatch(siteId, {
      type: 'proposal_status',
      actionId: proposal.actionId,
      status: OK_STATUS[op],
      ...(op === 'apply' ? { appliedAt: Date.now() } : {}),
    })
    if (op !== 'reject') dispatchAssistantApplied({ kind: proposal.kind, actionId: proposal.actionId, target: imageTargetOf(proposal.preview) })
    return { ok: true, summary: res.summary }
  }
  const code = toErrorCode(res.errors)
  const next = statusAfterError(code)
  if (next) dispatch(siteId, { type: 'proposal_status', actionId: proposal.actionId, status: next })
  // Someone resolved it elsewhere: the card is stale, but we cannot know how.
  return { ok: false, code }
}
