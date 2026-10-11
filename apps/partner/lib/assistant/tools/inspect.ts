/**
 * `inspect` -- the general-purpose system inspector (track 030 G3). One read-only tool that lets the
 * model discover how the system is put together: data model, editor capabilities, spatial frame,
 * plan / features, go-live state, money rules. The providers live in `../inspect/`.
 *
 * Scope: the open site and its owner's account come from the route-bound `ctx` (`defineTool` also
 * re-checks ownership); the input has no site / account field, and the schema rejects extra keys, so
 * the model cannot name anything else. Output is trimmed to `MAX_INSPECT_BYTES`.
 */
import { fitToBudget } from '../inspect/fit'
import { getInspectProvider, INSPECT_ASPECTS, INSPECT_PROVIDERS } from '../inspect'
import { MAX_INSPECT_BYTES } from '../inspect/types'
import { defineTool } from './helpers'

export const inspectTool = defineTool({
  name: 'inspect',
  label: 'Inspecting the system',
  description:
    `Look at how the system works, read-only, for the OPEN site and its account. Call inspect({ aspect: 'catalog' }) first when you are unsure where some information lives or which tool answers a question. Aspects: ${INSPECT_PROVIDERS.map((p) => `${p.name} (${p.summary})`).join('; ')}. Optional topic narrows an aspect (a table name for data, an operation name or area for editor, 'sea' for space); the catalog lists what each aspect accepts. Prefer inspect, sql and the spatial tools over asking the user. Output is compact and says when it was trimmed.`,
  properties: {
    aspect: { type: 'string', enum: [...INSPECT_ASPECTS] },
    topic: { type: 'string', minLength: 1, maxLength: 60, description: 'Narrow the aspect, e.g. a table name, an operation name, or sea' },
  },
  required: ['aspect'],
  async run(input, ctx) {
    const provider = getInspectProvider(String(input.aspect))
    if (!provider) return { ok: false, error: 'unknown_aspect', detail: `aspect must be one of: ${INSPECT_ASPECTS.join(', ')}` }
    const topic = typeof input.topic === 'string' ? input.topic.trim() : undefined
    const out = await provider.describe(ctx, topic || undefined)
    return fitToBudget(out, MAX_INSPECT_BYTES)
  },
})
