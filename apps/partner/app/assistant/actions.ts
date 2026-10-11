'use server'

/**
 * Apply / reject / undo of assistant proposals (track 030 S3) -- the only way a proposal changes
 * anything. Each call re-authorises (session -> account-scoped proposal -> requireSiteOwner, sudo ok)
 * inside `lib/assistant/proposals/lifecycle.ts`; the card's id is never trusted.
 *
 * Result: `{ status: 'ok', summary }` or `{ status: 'error', errors }` where `errors[0]` is a code:
 * not_found | forbidden | expired | stale | already_resolved | undo_window | apply_failed |
 * not_undoable | in_use (and 'Not authenticated'); `errors[1]` may carry a human detail.
 */
import { applyProposal, rejectProposal, undoProposal } from '@/lib/assistant/proposals/lifecycle'

export async function applyAssistantAction(
  actionId: string,
): Promise<{ status: 'ok' | 'error'; errors?: string[]; summary?: string }> {
  return applyProposal(actionId)
}

export async function rejectAssistantAction(
  actionId: string,
): Promise<{ status: 'ok' | 'error'; errors?: string[]; summary?: string }> {
  return rejectProposal(actionId)
}

export async function undoAssistantAction(
  actionId: string,
): Promise<{ status: 'ok' | 'error'; errors?: string[]; summary?: string }> {
  return undoProposal(actionId)
}
