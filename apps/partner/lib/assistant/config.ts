/**
 * Runtime switches for the partner assistant (track 030 D1/D7). Read at call time, not import time,
 * so a Vercel env change takes effect on the next request and tests can set them per case.
 */

/** Kill switch: BOTH the opt-in env var and the provider key must be present. */
export function assistantAvailable(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env.PARTNER_ASSISTANT_ENABLED ?? '').trim().toLowerCase()
  return (flag === '1' || flag === 'true') && !!env.ANTHROPIC_API_KEY
}

/** D1: chat + tool loop model. Overridable per environment without a deploy. */
export function assistantModelId(env: Record<string, string | undefined> = process.env): string {
  return env.PARTNER_ASSISTANT_MODEL?.trim() || 'claude-sonnet-5-5'
}

/** D1: layout / schematic extraction (vision, one-shot). Overridable per environment without a deploy. */
export function extractionModelId(env: Record<string, string | undefined> = process.env): string {
  return env.PARTNER_ASSISTANT_EXTRACTION_MODEL?.trim() || 'claude-opus-5-5'
}

/** Model calls per user turn (a tool round-trip is one extra call). */
export const MAX_STEPS_PER_TURN = 8

/** Stored messages after which a conversation must be restarted (the transcript is replayed whole). */
export const MAX_STORED_MESSAGES = 400

export const MAX_MESSAGE_CHARS = 4000
