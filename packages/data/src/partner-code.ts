/**
 * Partner codes (track 021).
 *
 * A stable, external identifier for a customer — the thing a device is flashed
 * with, so that internal identity can churn behind it. `PartnerAccount.userId`
 * is a User primary key: an account restructure, merge or migration changes it,
 * and every potted device carrying it would need collecting and reflashing. A
 * partner code survives that: repoint the code at the new account and the fleet
 * keeps working.
 *
 * Same reasoning as the device code, one level up — and the same rules, reused
 * rather than reinvented: Crockford base32 with I/L/O/U folded out, so it can be
 * read off a label in glare and typed without ambiguity.
 *
 * NOT a credential. It is flashed into every unit and extractable from any
 * image; it identifies, it does not authenticate (track 019 Q9).
 */

import { DEVICE_CODE_ALPHABET } from './device-code'

/**
 * The prefix is what stops a partner code and a device code being confused.
 * Both would otherwise be short Crockford strings sitting side by side in the
 * same firmware config and the same support conversation, and "which of these
 * is which" is a mistake someone makes at 7am on a beach.
 */
export const PARTNER_CODE_PREFIX = 'P-'
export const PARTNER_CODE_BODY_LENGTH = 5

/** Fold to the canonical form: uppercase, ambiguous glyphs mapped, prefix restored. */
export function normalizePartnerCode(raw: string): string {
  const folded = raw
    .trim()
    .toUpperCase()
    .replace(/^P-?/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
    .replace(/[^0-9A-Z]/g, '')
  return `${PARTNER_CODE_PREFIX}${folded}`
}

export function isValidPartnerCode(raw: string): boolean {
  const body = normalizePartnerCode(raw).slice(PARTNER_CODE_PREFIX.length)
  if (body.length !== PARTNER_CODE_BODY_LENGTH) return false
  return [...body].every((ch) => DEVICE_CODE_ALPHABET.includes(ch))
}

/**
 * Random, not sequential: a sequential code leaks how many customers exist, and
 * makes a neighbouring customer's fleet trivially guessable for the spoofing
 * surface the claim-not-authority rule already bounds.
 */
export function generatePartnerCode(
  randomInt: (max: number) => number = (max) => Math.floor(Math.random() * max),
): string {
  let body = ''
  for (let i = 0; i < PARTNER_CODE_BODY_LENGTH; i++) {
    body += DEVICE_CODE_ALPHABET[randomInt(DEVICE_CODE_ALPHABET.length)]
  }
  return `${PARTNER_CODE_PREFIX}${body}`
}
