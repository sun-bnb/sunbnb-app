/**
 * HW device codes — the public identifier printed on a device's sticker
 * (track 019, §Identity & client filter).
 *
 * PURE and client-safe: no prisma, no env. The provisioning script mints codes
 * with `generateDeviceCode` and the `/api/hw/{code}/*` routes resolve them with
 * `normalizeDeviceCode`, so both sides share ONE definition of what a code is.
 * They have to: a code minted under different rules than the route normalises by
 * is a device that can never be reached, and the sticker is already glued on.
 *
 * A code is **public and authenticates nothing** — it is printed on a sticker on
 * a public beach and routes to a seat binding. There is no secret on this surface
 * at all (Q9); do not grow this module into one.
 */

/**
 * Crockford base32: 0-9 and A-Z minus `I`, `L`, `O`, `U`. Exactly 32 symbols.
 *
 * `I`/`L`/`O` are out because they are unreadable against `1`/`0` on a small
 * label — and a human reads this aloud to support from a windy beach, which is
 * the entire reason for choosing this alphabet over hex or base36. `U` is out to
 * avoid minting accidental obscenities onto a customer-visible sticker.
 */
export const DEVICE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * 6 symbols = 32^6 ≈ 1.07 × 10^9. At 1 500 devices the birthday collision chance
 * is ~0.1%, which `Device.code @unique` plus a retry settles; widen to 8 above
 * ~100k devices. Short matters because the sticker's QR stays a low version, and
 * big modules still scan at arm's length in glare on a wet phone.
 */
export const DEVICE_CODE_LENGTH = 6

/**
 * Fold a scanned/typed/spoken code to its stored form: uppercase, `I`/`L` → `1`,
 * `O` → `0`. This is the decode half of the Crockford promise — the alphabet is
 * chosen so ambiguous glyphs have exactly one canonical landing place.
 *
 * MUST stay byte-identical to what minting produces; the HW routes normalise with
 * this before looking a device up.
 */
export function normalizeDeviceCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0')
}

/** A code is valid iff, once normalised, it is the right length and all in-alphabet. */
export function isValidDeviceCode(raw: string): boolean {
  const code = normalizeDeviceCode(raw)
  if (code.length !== DEVICE_CODE_LENGTH) return false
  return [...code].every((ch) => DEVICE_CODE_ALPHABET.includes(ch))
}

/**
 * Mint a random code.
 *
 * **Random, never sequential.** Sequential codes leak fleet size to anyone who
 * reads two stickers, and make the code space walkable.
 *
 * `randomBytes` with a 5-bit mask, not `% 32`: the alphabet is exactly 32 symbols
 * and 256 is a multiple of 32, so masking is uniform with no modulo bias — and
 * unlike `Math.random()` it is a CSPRNG. (Bias here would not be a security hole,
 * since the code is public, but a skewed alphabet raises collisions for free.)
 *
 * @param randomBytes injected for deterministic tests; defaults to node crypto.
 */
export function generateDeviceCode(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(DEVICE_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < DEVICE_CODE_LENGTH; i++) {
    code += DEVICE_CODE_ALPHABET[bytes[i]! & 31]
  }
  return code
}

function defaultRandomBytes(n: number): Uint8Array {
  // Required lazily so the module stays importable from a client bundle, which
  // has no node:crypto — nothing client-side calls this, but importing it at the
  // top would break the bundle for the pure helpers above.
  return require('crypto').randomBytes(n)
}
