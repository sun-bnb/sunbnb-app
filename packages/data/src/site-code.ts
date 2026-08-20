/**
 * Site codes (track 022) — the site half of the printed QR URL.
 *
 *     https://sunbnb.app/q/S-K7M2X9/1-1-1
 *                          ^^^^^^^^ this
 *
 * PURE and client-safe: no prisma, no env. Minting (the site-create wizard, the
 * backfill script) and lookup (the `/q/…` routes) must share ONE definition of
 * what a code is — the same reason `device-code.ts` says so. Here the stakes are
 * the same shape: a code minted under different folding rules than the route
 * normalises by is a venue whose printed cards are unreachable, and the cards are
 * already glued to loungers.
 *
 * Why a site needs an external identifier at all: `Site.id` is a 25-char cuid,
 * which is half of an 80-character URL and therefore half of the QR's density
 * problem. `Site.slug` cannot do this job — it is partner-editable (a rename
 * would kill every printed card at that venue), variable-length, and carries no
 * uniqueness constraint in the schema.
 *
 * **Public, and authenticates nothing.** It is printed on a card on a public
 * beach and routes to a public booking page. Do not grow this module into a
 * credential (the same stance as `device-code.ts`, track 019 Q9).
 */

import { DEVICE_CODE_ALPHABET } from './device-code'

/**
 * The prefix is what stops a site code, a partner code (`P-…`) and a device code
 * (bare) being confused — all three are short Crockford strings that end up side
 * by side in a support conversation. Same reasoning as `partner-code.ts`.
 */
export const SITE_CODE_PREFIX = 'S-'

/**
 * 6 symbols = 32^6 ≈ 1.07 × 10^9 — the founder's call over a 4-char body, which
 * would also have fitted. Deliberately its OWN constant rather than a reuse of
 * `DEVICE_CODE_LENGTH`: that one is documented as widening to 8 above ~100k
 * devices, and the printed-card budget is not the fleet's to spend.
 *
 * Length budget (production host): `https://sunbnb.app/q/` 21 + `S-XXXXXX` 8 +
 * `/` 1 + address 5–8 = 35–38 chars, against byte-mode ECC-M version 3's cap of
 * 42. That leaves 4 characters of headroom, so this constant could reach 10
 * before the symbol grows to version 4 — but every one of them is also headroom
 * for a longer unit address (a venue past parcel 99 or seq 99), which is the
 * claim on it that nobody gets to make deliberately.
 */
export const SITE_CODE_BODY_LENGTH = 6

/**
 * Fold a typed, spoken or lowercase-URL code to its stored form: uppercase,
 * `I`/`L` → `1`, `O` → `0`, `U` → `V`, prefix restored whether or not it was
 * given. The routes normalise with this before looking a site up, so a card read
 * aloud over the phone and typed in lowercase still lands.
 */
export function normalizeSiteCode(raw: string): string {
  const folded = raw
    .trim()
    .toUpperCase()
    .replace(/^S-?/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
    .replace(/[^0-9A-Z]/g, '')
  return `${SITE_CODE_PREFIX}${folded}`
}

/** Valid iff, once normalised, the body is the right length and all in-alphabet. */
export function isValidSiteCode(raw: string): boolean {
  const body = normalizeSiteCode(raw).slice(SITE_CODE_PREFIX.length)
  if (body.length !== SITE_CODE_BODY_LENGTH) return false
  return [...body].every((ch) => DEVICE_CODE_ALPHABET.includes(ch))
}

/**
 * Mint a random code.
 *
 * **Random, never sequential.** A sequential code leaks how many venues the
 * platform has, and makes the space walkable from a single scanned card.
 *
 * `randomBytes` with a 5-bit mask rather than `% 32`: 256 is a multiple of 32, so
 * masking is uniform with no modulo bias. Bias would not be a security hole (the
 * code is public) but a skewed alphabet raises collisions for free.
 *
 * @param randomBytes injected for deterministic tests; defaults to node crypto.
 */
export function generateSiteCode(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(SITE_CODE_BODY_LENGTH)
  let body = ''
  for (let i = 0; i < SITE_CODE_BODY_LENGTH; i++) {
    body += DEVICE_CODE_ALPHABET[bytes[i]! & 31]
  }
  return `${SITE_CODE_PREFIX}${body}`
}

/**
 * Is this error the `Site.code` unique constraint, and nothing else?
 *
 * Every writer mints optimistically and retries on collision rather than
 * pre-checking (a check-then-write races anyway, and at 32^6 a collision is
 * vanishingly rare). That retry MUST be able to tell this constraint from the
 * other unique columns on `Site` — retrying a `restaurantId` collision five times
 * with fresh site codes would burn the retries and then rethrow an error the
 * caller already could have surfaced.
 */
export function isSiteCodeCollision(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } }
  if (e?.code !== 'P2002') return false
  const target = e.meta?.target
  if (Array.isArray(target)) return target.includes('code')
  if (typeof target === 'string') return target.includes('code')
  // Some drivers omit `target`. Treat an unattributable P2002 on a path that
  // just minted a code as a collision: a retry is cheap and self-limiting,
  // whereas refusing to retry strands site creation on a rare, invisible clash.
  return true
}

function defaultRandomBytes(n: number): Uint8Array {
  // Required lazily so the module stays importable from a client bundle (no
  // node:crypto there) — the pure helpers above are the ones clients use.
  return require('crypto').randomBytes(n)
}
