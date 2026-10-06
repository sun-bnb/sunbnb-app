/**
 * Rate-limit policy for the marketing site (track 027, bot protection) — pure, one table.
 *
 * Bot protection stays third-party-free (founder decision 2026-10-04): limits per IP, counted in
 * the shared database counter (`@repo/data/rate-limit-shared`) so they hold across serverless
 * instances, plus a global daily cap on AI turns — the Anthropic key has no provider-side spend
 * limit, so this cap IS the spend limit.
 */
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const LIMITS = {
  mockup: { maxAttempts: 20, windowMs: HOUR },
  layout: { maxAttempts: 120, windowMs: HOUR },
  demo: { maxAttempts: 5, windowMs: HOUR },
  projection: { maxAttempts: 60, windowMs: HOUR },
  chat: { maxAttempts: 30, windowMs: 10 * MIN },
  guide: { maxAttempts: 20, windowMs: 10 * MIN },
  /** AI turns (guide + chat) per IP per day — one visitor can't spend the whole daily budget. */
  aiPerIp: { maxAttempts: 150, windowMs: DAY },
  placesAutocomplete: { maxAttempts: 120, windowMs: MIN },
  placesDetails: { maxAttempts: 60, windowMs: MIN },
  coastline: { maxAttempts: 30, windowMs: MIN },
  events: { maxAttempts: 200, windowMs: 10 * MIN },
  /** "Your beach" emails per recipient ADDRESS per day — the form can't be used to mail-bomb someone. */
  prospectEmail: { maxAttempts: 2, windowMs: DAY },
} as const

export type LimitScope = keyof typeof LIMITS

export const AI_DAY_MS = DAY

/** Default global AI turns per day (guide + chat): roughly €20–60 of Haiku at the worst case. */
export const DEFAULT_AI_DAILY_TURNS = 2000

/**
 * The global daily AI budget from `MARKETING_AI_DAILY_TURNS`. A non-negative integer is used as
 * given (0 turns the AI off); anything else falls back to the default rather than to "unlimited".
 */
export function aiDailyBudget(raw: string | undefined = process.env.MARKETING_AI_DAILY_TURNS): number {
  if (raw !== undefined && /^\d{1,7}$/.test(raw.trim())) return Number(raw.trim())
  return DEFAULT_AI_DAILY_TURNS
}
