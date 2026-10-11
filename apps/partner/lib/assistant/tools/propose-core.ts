/**
 * Shared plumbing for the assistant's write tools (track 030 S3/S4a, act-immediately since 2026-10-11):
 * validate -> store an `AssistantAction` -> APPLY it in the same call (`createAndApply`) -> emit the
 * card as applied. The one exception is a proposal that deletes something: it stays pending behind the
 * typed confirmation (deletes are not undoable).
 */
import { createAndApply, type ActOutcome } from '../proposals/act'
import type { Diff, KindHandler } from '../proposals/types'
import { defineTool, type AssistantTool, type AssistantToolCtx } from './helpers'

export const APPLIED_INSTRUCTION =
  'This change was APPLIED just now (the user sees it as a done card with an Undo button). Tell the user plainly what you did, mention any warnings, and mention that they can Undo it. Do not ask for confirmation and do not call it a proposal.'

export const PENDING_DELETE_INSTRUCTION =
  'This DELETES something and was NOT applied: deletes cannot be undone, so the user must type DELETE on the card and press Apply. Say what will be deleted and that it is waiting for their confirmation; never say it was done.'

/** Kept for callers that still import it. */
export const INSTRUCTION = PENDING_DELETE_INSTRUCTION

export type Plan<P> = { payload: P; warnings?: string[] } | { errors: string[] }

export function proposeTool<P>(def: {
  name: string
  label: string
  description: string
  properties: Record<string, Record<string, unknown>>
  required?: string[]
  handler: KindHandler<P, unknown>
  plan: (input: Record<string, unknown>, ctx: AssistantToolCtx) => Plan<P> | Promise<Plan<P>>
}): AssistantTool {
  return defineTool({
    name: def.name,
    label: def.label,
    description: `${def.description} APPLIES the change immediately (the user can Undo it for 24 h) and returns what was done; only a change that deletes things waits for the user's typed confirmation.`,
    properties: def.properties,
    required: def.required,
    async run(input, ctx) {
      return submitProposal(ctx, def.handler, await def.plan(input, ctx))
    },
  })
}

/** The model-facing fields of one outcome's card (shared with the multi-card tools). */
export function describeOutcome(out: Extract<ActOutcome, { ok: true }>) {
  const { card } = out
  const preview: Diff = card.preview
  return {
    actionId: card.actionId,
    status: out.applied ? 'applied' : 'proposed',
    summary: card.summary,
    changes: preview.changes,
    ...(preview.creates ? { creates: preview.creates } : {}),
    ...(preview.deletes ? { deletes: preview.deletes } : {}),
    ...(preview.warnings ? { warnings: preview.warnings } : {}),
    instruction: out.applied ? APPLIED_INSTRUCTION : PENDING_DELETE_INSTRUCTION,
  }
}

/** Store a planned change, apply it (unless it deletes) and shape the model-facing result (proposeTool and run_js). */
export async function submitProposal<P>(ctx: AssistantToolCtx, handler: KindHandler<P, unknown>, planned: Plan<P>) {
  if ('errors' in planned) return { ok: false, errors: planned.errors }
  const out = await createAndApply(ctx, handler, planned.payload, planned.warnings ?? [])
  if (!out.ok) return { ok: false, error: out.error }
  return { ok: true, ...describeOutcome(out) }
}
