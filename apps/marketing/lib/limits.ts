import 'server-only'
import { rateLimitShared } from '@repo/data/rate-limit-shared'
import { AI_DAY_MS, aiDailyBudget, LIMITS, type LimitScope } from './limit-policy.ts'
import { notifyAiBudgetReached } from './notify.ts'

/** Count one attempt for `subject` (an IP, an email address) under `scope`'s policy. */
export async function allow(scope: LimitScope, subject: string): Promise<boolean> {
  return (await rateLimitShared(`${scope}:${subject}`, LIMITS[scope])).allowed
}

/**
 * Gate one AI turn: the route's own per-IP burst limit, the per-IP daily cap, then the global
 * daily budget. Checked in that order so a rejected visitor never spends the shared budget. The
 * first turn over the budget emails the team once — the counter is atomic, so exactly one request
 * sees `budget + 1`.
 */
export async function allowAiTurn(route: 'chat' | 'guide', ip: string): Promise<'ok' | 'rate_limited' | 'budget'> {
  if (!(await allow(route, ip)) || !(await allow('aiPerIp', ip))) return 'rate_limited'
  const budget = aiDailyBudget()
  const { allowed, count } = await rateLimitShared('ai-budget:global', { maxAttempts: budget, windowMs: AI_DAY_MS })
  if (allowed) return 'ok'
  if (count === budget + 1) await notifyAiBudgetReached(budget)
  return 'budget'
}
