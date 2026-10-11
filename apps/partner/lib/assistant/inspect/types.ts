/**
 * The system inspector (track 030 G3): `inspect({ aspect, topic? })` lets the model look at how the
 * system is put together -- data model, editor capabilities, spatial conventions, plan/features,
 * go-live state, money rules -- without a tool per question.
 *
 * Every provider is READ-ONLY and bound to the ROUTE's context: the open site and its owner's
 * account come from `AssistantToolCtx`, never from the model. A provider reads only what the partner
 * may already see in the portal, and never returns a secret (tokens, IBAN, other tenants' rows).
 */
import type { AssistantToolCtx } from '../tools/helpers'

export interface InspectProvider {
  /** The `aspect` value. */
  name: string
  /** One line: what this aspect tells the model. */
  summary: string
  /** Questions this aspect answers (shown by the catalog). */
  examples: string[]
  /** What `topic` accepts for this aspect, if anything. */
  topics?: string
  describe(ctx: AssistantToolCtx, topic?: string): Promise<unknown> | unknown
}

/** Largest serialized provider output; beyond it the result is trimmed and says so. */
export const MAX_INSPECT_BYTES = 8_000
