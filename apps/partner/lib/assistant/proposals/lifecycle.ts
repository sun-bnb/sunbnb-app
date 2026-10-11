/**
 * apply / reject / undo of an assistant proposal (track 030 S3).
 *
 * The server actions in `app/assistant/actions.ts` are thin wrappers over these. Every entry point
 * re-authorises from scratch -- the model, the card and the stored row are all untrusted:
 *   session -> proposal scoped to the caller's account (a sudo may reach another account's) ->
 *   `requireSiteOwner(action.siteId)` (sudo ok) -> the site still belongs to the proposal's account.
 * A foreign / unknown id is `not_found`; a real proposal on a site the caller no longer owns is
 * `forbidden`. Writes happen only through the existing, individually-authorised server actions.
 */
import { revalidatePath } from 'next/cache'
import {
  appendMessages,
  ASSISTANT_ACTION_STATUS as STATUS,
  ASSISTANT_UNDO_WINDOW_MS,
  getProposalForAccount,
  markApplied,
  markFailed,
  markRejected,
  markUndone,
} from '@repo/data/assistant'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { ID } from '../request'
import { readPayload, readPreview } from './create'
import { HANDLERS } from './registry'
import { invalidateSnapshot } from '../snapshot/cache'
import { diffBasis, isEmptyDiff, ProposalError, summarizeDiff, type Diff, type HandlerCtx, type KindHandler } from './types'

export type AssistantActionError =
  | 'not_found'
  | 'forbidden'
  | 'expired'
  | 'stale'
  | 'already_resolved'
  | 'undo_window'
  | 'apply_failed'
  | 'not_undoable'
  | 'in_use'

export type ActionResult =
  | { status: 'ok'; summary: string }
  | { status: 'error'; errors: string[] }

const fail = (...errors: string[]): ActionResult => ({ status: 'error', errors })

type Json = Parameters<typeof markApplied>[2]
type Row = NonNullable<Awaited<ReturnType<typeof getProposalForAccount>>>

interface Resolved {
  action: Row
  handler: KindHandler<unknown, unknown>
  ctx: HandlerCtx
  payload: unknown
  stored: Diff & { summary: string }
}

async function resolve(actionId: unknown): Promise<Resolved | ActionResult> {
  if (typeof actionId !== 'string' || !ID.test(actionId)) return fail('not_found')
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return fail('Not authenticated')

  let action = await getProposalForAccount(actionId, userId)
  if (!action) {
    // A sudo may act on another account's proposal; the lookup stays account-scoped once the
    // owning account is known. Everyone else sees a foreign id exactly like a missing one.
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { sudo: true } })
    if (me?.sudo) {
      const raw = await prisma.assistantAction.findUnique({ where: { id: actionId }, select: { accountId: true } })
      if (raw) action = await getProposalForAccount(actionId, raw.accountId)
    }
  }
  if (!action) return fail('not_found')

  const { error } = await requireSiteOwner(action.siteId)
  if (error) return fail('forbidden', error)
  const site = await prisma.site.findUnique({ where: { id: action.siteId }, select: { userId: true } })
  if (!site || site.userId !== action.accountId) return fail('forbidden', 'Not authorized')

  const handler = HANDLERS[action.kind]
  if (!handler) return fail('apply_failed', `Unknown proposal kind: ${action.kind}`)
  const { summary, preview } = readPreview(action.preview)
  return {
    action,
    handler,
    ctx: { siteId: action.siteId, accountId: action.accountId },
    payload: readPayload(action.payload),
    stored: { ...preview, summary },
  }
}

const isResult = (r: Resolved | ActionResult): r is ActionResult => 'status' in r

function refresh(action: Row) {
  invalidateSnapshot(action.siteId) // the sql tool's data copy is stale after any write
  try {
    revalidatePath(`/sites/${action.siteId}`, 'layout')
    revalidatePath('/sites')
    if (action.kind === 'account_fields') revalidatePath('/account')
  } catch (err) {
    console.error('[assistant] revalidate failed', err)
  }
}

/** Append-only note so the model sees the outcome on its next turn. Never fails the action. */
async function note(action: Row, text: string) {
  try {
    await appendMessages(action.conversationId, action.accountId, [{ role: 'user', content: text, note: true }] as never)
  } catch (err) {
    console.error('[assistant] could not append the action note', err)
  }
}

const message = (err: unknown) => (err instanceof ProposalError ? err.message : 'Unexpected error')

// ─── apply ──────────────────────────────────────────────────────────────────

export async function applyProposal(actionId: unknown): Promise<ActionResult> {
  const r = await resolve(actionId)
  if (isResult(r)) return r
  const { action, handler, ctx, payload, stored } = r

  if (action.status === STATUS.EXPIRED) return fail('expired')
  if (action.status !== STATUS.PROPOSED) return fail('already_resolved')
  if (action.expiresAt.getTime() <= Date.now()) return fail('expired')

  // Stale: the data must still be exactly what the user reviewed.
  let fresh: Diff
  try {
    fresh = await handler.diff(ctx, payload)
  } catch (err) {
    if (!(err instanceof ProposalError)) throw err
    await markFailed(action.id, action.accountId, { error: err.message } as Json)
    await note(action, `[failed] ${stored.summary}: ${err.message}`)
    return fail('apply_failed', err.message)
  }
  if (diffBasis(fresh) !== diffBasis(stored)) {
    await markFailed(action.id, action.accountId, { error: 'stale' } as Json)
    await note(action, `[failed] ${stored.summary}: the data changed after this was proposed, nothing was applied`)
    return fail('stale')
  }

  const snapshot = await handler.snapshot(ctx, payload)
  const done: string[] = []
  try {
    await handler.execute(ctx, payload, done)
  } catch (err) {
    // Stop at the first failure. Steps that already ran are rolled back from the snapshot so the
    // user is not left with half a change; if even that fails the snapshot is kept on the row.
    let rolledBack = false
    if (done.length > 0) {
      try {
        await handler.restore(ctx, payload, snapshot, done)
        rolledBack = true
      } catch (restoreErr) {
        console.error('[assistant] rollback after a failed apply failed', restoreErr)
      }
    }
    await markFailed(action.id, action.accountId, { error: message(err), startedSteps: done, rolledBack, snapshot } as Json)
    refresh(action)
    const tail = done.length === 0 ? 'nothing was changed' : rolledBack ? 'the steps already done were rolled back' : 'some steps were applied and could not be rolled back'
    await note(action, `[failed] ${stored.summary}: ${message(err)} (${tail})`)
    return fail('apply_failed', `${message(err)} (${tail})`)
  }

  const summary = stored.summary || summarizeDiff(fresh)
  const marked = await markApplied(action.id, action.accountId, snapshot as Json, { summary, steps: done } as Json)
  if (!marked) {
    const again = await getProposalForAccount(action.id, action.accountId)
    if (again?.status === STATUS.APPLIED) return fail('already_resolved')
    // Expired / resolved between the check and the write: do not leave an unrecorded change behind.
    try {
      await handler.restore(ctx, payload, snapshot)
    } catch (err) {
      console.error('[assistant] rollback after a lost apply race failed', err)
    }
    refresh(action)
    return fail('expired')
  }
  refresh(action)
  await note(action, `[applied] ${summary}`)
  return { status: 'ok', summary }
}

// ─── reject ─────────────────────────────────────────────────────────────────

export async function rejectProposal(actionId: unknown): Promise<ActionResult> {
  const r = await resolve(actionId)
  if (isResult(r)) return r
  const { action, stored } = r
  if (action.status === STATUS.EXPIRED) return fail('expired')
  if (action.status !== STATUS.PROPOSED) return fail('already_resolved')
  if (!(await markRejected(action.id, action.accountId))) return fail('already_resolved')
  await note(action, `[rejected] ${stored.summary}`)
  return { status: 'ok', summary: stored.summary }
}

// ─── undo ───────────────────────────────────────────────────────────────────

export async function undoProposal(actionId: unknown): Promise<ActionResult> {
  const r = await resolve(actionId)
  if (isResult(r)) return r
  const { action, handler, ctx, payload, stored } = r

  if (action.status !== STATUS.APPLIED) return fail('already_resolved')
  const appliedAt = action.appliedAt?.getTime() ?? 0
  if (Date.now() - appliedAt > ASSISTANT_UNDO_WINDOW_MS) return fail('undo_window')
  if (action.snapshot == null) return fail('apply_failed', 'No snapshot was recorded for this change')
  if (!stored.changes?.length && !stored.creates?.length) {
    return fail('not_undoable', 'Removals cannot be undone')
  }

  // Stale: undo only if what the proposal wrote is still intact -- otherwise it would clobber a later edit.
  try {
    const now = await handler.diff(ctx, payload, { applied: true })
    if (!isEmptyDiff(now)) return fail('stale')
  } catch (err) {
    if (err instanceof ProposalError) return fail('stale')
    throw err
  }

  const snapshot = action.snapshot
  try {
    const blocker = await handler.undoBlocker?.(ctx, payload, snapshot)
    if (blocker) return fail('in_use', blocker)
    await handler.restore(ctx, payload, snapshot)
  } catch (err) {
    refresh(action)
    return fail('apply_failed', message(err))
  }

  if (!(await markUndone(action.id, action.accountId))) {
    refresh(action)
    return fail('already_resolved')
  }
  refresh(action)
  const removed = stored.deletes?.length ? ' (removed items are not restored)' : ''
  await note(action, `[undone] ${stored.summary}${removed}`)
  return { status: 'ok', summary: `${stored.summary}${removed}` }
}
