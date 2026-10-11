/**
 * AI-turn budget for the partner assistant (track 030 D7) — the same gate marketing uses
 * (`@repo/agent/limits`), over the shared database counter so it holds across serverless instances.
 *
 *   per account: 30 turns / 10 min burst, 150 turns / day
 *   global:      PARTNER_AI_DAILY_TURNS per day (default 1000; 0 = AI off)
 *
 * The Anthropic key has no provider-side spend limit, so these caps ARE the spend limit.
 */
import { allowAiTurn, parseTurnBudget, type AiTurnDecision, type CounterStore } from '@repo/agent/limits'
import { sendEmail } from '@repo/data/email'
import { rateLimitShared } from '@repo/data/rate-limit-shared'

const MIN = 60_000
const DAY = 24 * 60 * MIN

export const ASSISTANT_LIMITS = {
  burst: { maxAttempts: 30, windowMs: 10 * MIN },
  daily: { maxAttempts: 150, windowMs: DAY },
} as const

export const DEFAULT_ASSISTANT_DAILY_TURNS = 1000

export function assistantDailyBudget(raw: string | undefined = process.env.PARTNER_AI_DAILY_TURNS): number {
  return parseTurnBudget(raw, DEFAULT_ASSISTANT_DAILY_TURNS)
}

const sharedCounter: CounterStore = { hit: (key, policy) => rateLimitShared(key, policy) }

/** One email to the team when the global budget trips; falls back to the log if mail is unavailable. */
export async function notifyAssistantBudgetReached(budget: number): Promise<void> {
  console.error(`[partner] assistant daily budget of ${budget} turns reached; assistant off until 00:00 UTC`)
  try {
    await sendEmail({
      to: process.env.ASSISTANT_NOTIFY_EMAIL || process.env.LEADS_NOTIFY_EMAIL || 'info@sunbnb.app',
      subject: `Partner assistant: daily AI budget reached (${budget} turns)`,
      html:
        `<p>The partner assistant has answered ${budget} turns today, the daily cap. Until 00:00 UTC it is off; ` +
        `the rest of the partner portal keeps working.</p>` +
        `<p>If this is real usage, raise <code>PARTNER_AI_DAILY_TURNS</code> in Vercel. If it is not, ` +
        `this cap just did its job — check the Anthropic usage console.</p>`,
    })
  } catch (err) {
    console.error('[partner] assistant budget notification failed', err)
  }
}

/**
 * Gate one assistant turn for `accountId` (the signed-in user). Per-account checks run first, so a
 * rejected account never spends the shared budget.
 */
export async function allowAssistantTurn(
  accountId: string,
  deps: { store?: CounterStore; budget?: number; notify?: (budget: number) => void | Promise<void> } = {},
): Promise<AiTurnDecision> {
  const maxTurns = deps.budget ?? assistantDailyBudget()
  // 0 means "AI off": refuse without counting or mailing (the counter would call that a trip).
  if (maxTurns === 0) return 'budget'
  return allowAiTurn(deps.store ?? sharedCounter, {
    checks: [
      { key: `assistant:burst:${accountId}`, policy: ASSISTANT_LIMITS.burst },
      { key: `assistant:day:${accountId}`, policy: ASSISTANT_LIMITS.daily },
    ],
    budget: { key: 'assistant:budget:global', maxTurns, windowMs: DAY },
    onBudgetReached: deps.notify ?? notifyAssistantBudgetReached,
  })
}

/** D7: 10 document-extraction turns (turns carrying attachments) per account per day. */
export const EXTRACTION_JOBS_PER_DAY = 10

export async function allowExtractionJob(accountId: string, store: CounterStore = sharedCounter): Promise<boolean> {
  const r = await store.hit(`assistant:extract:${accountId}`, { maxAttempts: EXTRACTION_JOBS_PER_DAY, windowMs: DAY })
  return r.allowed
}

/**
 * Track 030 S7: aerial-photo extractions (one high-effort Opus vision call each) per account per day.
 * A sub-cap: each one ALSO counts as one of the EXTRACTION_JOBS_PER_DAY. Only a real model call is
 * counted -- a cached descriptor never reaches this.
 */
export const AERIAL_EXTRACTIONS_PER_DAY = 3

export async function allowAerialExtraction(accountId: string, store: CounterStore = sharedCounter): Promise<boolean> {
  const r = await store.hit(`assistant:aerial:${accountId}`, { maxAttempts: AERIAL_EXTRACTIONS_PER_DAY, windowMs: DAY })
  return r.allowed
}
