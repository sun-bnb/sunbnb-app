/**
 * A generic AI-turn budget (`@repo/agent`, track 030 S0) — extracted from marketing's
 * `allowAiTurn` so the partner assistant enforces the same shape (track 030 D7).
 *
 * One turn is gated by, in order:
 *   1. the caller's per-key checks (e.g. a burst window, then a daily cap per IP / per account) —
 *      the first one that fails rejects the turn as `rate_limited`;
 *   2. a global budget (turns per window). The first turn over it fires `onBudgetReached` ONCE:
 *      the counter is atomic, so exactly one request sees `count === budget + 1`.
 * Checked in that order so a rejected caller never spends the shared budget.
 *
 * Storage is an adapter (`CounterStore`) so this module stays Prisma-free; apps pass
 * `rateLimitShared` from `@repo/data/rate-limit-shared` (shared across serverless instances).
 */

export interface LimitPolicy {
  maxAttempts: number
  windowMs: number
}

/** Counts one attempt against `key` in the current fixed window. */
export interface CounterStore {
  hit(key: string, policy: LimitPolicy): Promise<{ allowed: boolean; count: number }>
}

export interface AiTurnGate {
  /** Per-key checks, run in order; each counts an attempt only if every earlier one passed. */
  checks: readonly { key: string; policy: LimitPolicy }[]
  /** Global budget. `maxTurns: 0` turns the AI off. */
  budget: { key: string; maxTurns: number; windowMs: number }
  /** Called once, by the first turn over the budget (e.g. email the team). */
  onBudgetReached?: (budget: number) => void | Promise<void>
}

export type AiTurnDecision = 'ok' | 'rate_limited' | 'budget'

export async function allowAiTurn(store: CounterStore, gate: AiTurnGate): Promise<AiTurnDecision> {
  for (const check of gate.checks) {
    if (!(await store.hit(check.key, check.policy)).allowed) return 'rate_limited'
  }
  const { key, maxTurns, windowMs } = gate.budget
  const { allowed, count } = await store.hit(key, { maxAttempts: maxTurns, windowMs })
  if (allowed) return 'ok'
  if (count === maxTurns + 1) await gate.onBudgetReached?.(maxTurns)
  return 'budget'
}

/**
 * A budget from an env value: a non-negative whole number (up to 7 digits) is used as given — 0
 * turns the AI off; anything else falls back to `fallback`, never to "unlimited".
 */
export function parseTurnBudget(raw: string | undefined, fallback: number): number {
  if (raw !== undefined && /^\d{1,7}$/.test(raw.trim())) return Number(raw.trim())
  return fallback
}
