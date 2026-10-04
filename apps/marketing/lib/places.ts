/**
 * Input rules for the beach form and the Google Places proxy.
 *
 * This page is the target of paid ads, so its Places proxy is a public endpoint spending our
 * Google key: every parameter is validated before it is forwarded, and the routes are
 * rate-limited per IP (`app/api/places/*`). Pure — no fetch, no Next — so it is unit-tested.
 */
import { MAX_SUNBEDS } from './agent/tools.ts'

export { MAX_SUNBEDS }

export const MAX_QUERY_LENGTH = 200
/** Google Place IDs are URL-safe base64-ish, typically < 300 chars. */
export const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/
/** Places session tokens are ours (crypto.randomUUID()). */
export const SESSION_TOKEN_RE = /^[0-9a-f-]{36}$/
export const SUPPORTED_LOCALES = ['en', 'es', 'fi'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export function isValidQuery(input: string | null): input is string {
  return !!input && input.trim().length > 0 && input.length <= MAX_QUERY_LENGTH
}

export function isValidPlaceId(id: string | null): id is string {
  return !!id && PLACE_ID_RE.test(id)
}

export function isValidSessionToken(token: string | null): token is string {
  return !!token && SESSION_TOKEN_RE.test(token)
}

/** Parses the sunbed count as typed: whole numbers 1..MAX_SUNBEDS only. */
export function parseSunbedCount(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,5}$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return n >= 1 && n <= MAX_SUNBEDS ? n : null
}

/** The `/beach?place=…&beds=…` contract between the form and the mockup page. */
export function parseBeachParams(params: { place?: string | string[]; beds?: string | string[] }):
  | { placeId: string; sunbedCount: number }
  | null {
  const place = typeof params.place === 'string' ? params.place : null
  const beds = typeof params.beds === 'string' ? params.beds : null
  const sunbedCount = parseSunbedCount(beds)
  if (!isValidPlaceId(place) || sunbedCount === null) return null
  return { placeId: place, sunbedCount }
}

/** First hop of x-forwarded-for (Vercel sets it); 'unknown' groups header-less callers together. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export function localeOrDefault(locale: string | null | undefined): Locale {
  return SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : 'en'
}
