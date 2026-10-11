/**
 * Shared plumbing for the proposal-only write tools (track 030 S3/S4a): validate -> store an
 * `AssistantAction(status=proposed)` -> emit the `proposal` card. Never changes site data.
 */
import { createProposalFor } from '../proposals/create'
import type { KindHandler } from '../proposals/types'
import { defineTool, type AssistantTool, type AssistantToolCtx } from './helpers'

export const INSTRUCTION =
  'This is only a PROPOSAL: nothing has changed. The user sees it as a card and must click Apply. Summarise what will change in your reply and never say it was applied.'

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
    description: `${def.description} PROPOSES the change for the user to review and apply; it never changes anything itself.`,
    properties: def.properties,
    required: def.required,
    async run(input, ctx) {
      return submitProposal(ctx, def.handler, await def.plan(input, ctx))
    },
  })
}

/** Store a planned proposal and shape the model-facing result (shared by proposeTool and run_js). */
export async function submitProposal<P>(ctx: AssistantToolCtx, handler: KindHandler<P, unknown>, planned: Plan<P>) {
  if ('errors' in planned) return { ok: false, errors: planned.errors }
  const created = await createProposalFor(ctx, handler, planned.payload, planned.warnings ?? [])
  if (!created.ok) return { ok: false, error: created.error }
  const { card } = created
  return {
    ok: true,
    actionId: card.actionId,
    status: 'proposed',
    summary: card.summary,
    changes: card.preview.changes,
    ...(card.preview.creates ? { creates: card.preview.creates } : {}),
    ...(card.preview.deletes ? { deletes: card.preview.deletes } : {}),
    ...(card.preview.warnings ? { warnings: card.preview.warnings } : {}),
    instruction: INSTRUCTION,
  }
}
