import 'server-only'
import { allowAiTurn as allowAiTurnWith, type CounterStore } from '@repo/agent/limits'
import { rateLimitShared } from '@repo/data/rate-limit-shared'
import { AI_DAY_MS, aiDailyBudget, LIMITS, type LimitScope } from './limit-policy.ts'
import { notifyAiBudgetReached } from './notify.ts'

/** The shared database counter (`@repo/data/rate-limit-shared`) as an `@repo/agent` counter store. */
const sharedCounter: CounterStore = { hit: (key, policy) => rateLimitShared(key, policy) }

/** Count one attempt for `subject` (an IP, an email address) under `scope`'s policy. */
export async function allow(scope: LimitScope, subject: string): Promise<boolean> {
  return (await rateLimitShared(`${scope}:${subject}`, LIMITS[scope])).allowed
}

/**
 * Gate one AI turn: the route's own per-IP burst limit, the per-IP daily cap, then the global
 * daily budget. Checked in that order so a rejected visitor never spends the shared budget. The
 * first turn over the budget emails the team once — the counter is atomic, so exactly one request
 * sees `budget + 1`. The gate itself is `@repo/agent/limits` (track 030 S0, shared with the
 * partner assistant).
 */
export async function allowAiTurn(route: 'chat' | 'guide', ip: string): Promise<'ok' | 'rate_limited' | 'budget'> {
  return allowAiTurnWith(sharedCounter, {
    checks: [
      { key: `${route}:${ip}`, policy: LIMITS[route] },
      { key: `aiPerIp:${ip}`, policy: LIMITS.aiPerIp },
    ],
    budget: { key: 'ai-budget:global', maxTurns: aiDailyBudget(), windowMs: AI_DAY_MS },
    onBudgetReached: notifyAiBudgetReached,
  })
}
