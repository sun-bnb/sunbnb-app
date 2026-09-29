/**
 * Tax-identifier validation (track 026).
 *
 * PURE and OFFLINE — no prisma, no network. A client component may import it,
 * so the partner sees the same verdict while typing that the server applies on
 * save.
 *
 * ## Why this exists
 *
 * `PartnerAccount.businessId` has never been validated anywhere. In production
 * the largest partner's is the literal string `"Alonso Beach"` and another
 * account holds `"wdcecec"`. That id is stamped onto every invoice as
 * `issuerVatNumber` and is an input to the invoice hash, so a junk value is not
 * a cosmetic problem: it is baked into the integrity chain of every document
 * that partner issues.
 *
 * ## What it deliberately is NOT
 *
 * **Not a VIES lookup.** Checking an id against the EU's registry means a
 * network call to a service with a long history of being slow or down, on a
 * path that must not fail. Format and checksum catch typos and nonsense, which
 * is the entire problem we actually have. An online existence check, if it is
 * ever wanted, belongs in a background job whose failure costs nothing.
 *
 * **Not an authority on who is registered for VAT.** A well-formed id can
 * belong to nobody. This answers "could this be a real identifier", not "is it".
 */

/** How far an identifier got. Stored on the partner, never used to block a sale. */
export type VatIdStatus =
  /** Nothing entered. */
  | 'missing'
  /** Wrong shape, or the checksum does not hold. Almost always a typo or a name. */
  | 'invalid'
  /** Well-formed, but this country has no checksum we implement — shape only. */
  | 'unchecked'
  /** Shape and checksum both hold. */
  | 'valid'

export interface VatIdResult {
  status: VatIdStatus
  /** Upper-cased, stripped of spaces, dots and hyphens. Empty when missing. */
  normalized: string
  /** Why it was rejected, for a form field. Null unless `invalid`. */
  error: string | null
}

/** Strip the punctuation people type and fold to upper case. */
export function normalizeVatId(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[\s.\-/]/g, '').toUpperCase()
}

// ─── Spain ───────────────────────────────────────────────────────────────────

/** The mod-23 control letters, in the order the algorithm indexes them. */
const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

/** CIF control letters, indexed by the computed control digit. */
const CIF_LETTERS = 'JABCDEFGHI'

/** Entity types whose control character must be a LETTER. */
const CIF_LETTER_ONLY = 'PQRSNW'
/** Entity types whose control character must be a DIGIT. */
const CIF_DIGIT_ONLY = 'ABEH'

/** NIF of a natural person: 8 digits plus a mod-23 letter. */
function checkSpanishNif(id: string): boolean {
  if (!/^\d{8}[A-Z]$/.test(id)) return false
  return NIF_LETTERS[Number(id.slice(0, 8)) % 23] === id[8]
}

/** NIE (foreign resident): X/Y/Z stands in for a leading 0/1/2, then as NIF. */
function checkSpanishNie(id: string): boolean {
  if (!/^[XYZ]\d{7}[A-Z]$/.test(id)) return false
  const lead = { X: '0', Y: '1', Z: '2' }[id[0] as 'X' | 'Y' | 'Z']
  return NIF_LETTERS[Number(lead + id.slice(1, 8)) % 23] === id[8]
}

/**
 * CIF of a legal entity: an entity-type letter, 7 digits, and a control
 * character that is a digit for some entity types, a letter for others, and
 * either for the rest.
 */
function checkSpanishCif(id: string): boolean {
  if (!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) return false

  const type = id[0]!
  const digits = id.slice(1, 8)
  const control = id[8]!

  let evenSum = 0
  let oddSum = 0
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i])
    if (i % 2 === 1) {
      // 2nd, 4th, 6th digit (1-indexed): taken as they are.
      evenSum += d
    } else {
      // 1st, 3rd, 5th, 7th: doubled, then folded back to one digit.
      const doubled = d * 2
      oddSum += doubled > 9 ? doubled - 9 : doubled
    }
  }

  const controlDigit = (10 - ((evenSum + oddSum) % 10)) % 10
  const controlLetter = CIF_LETTERS[controlDigit]!

  if (CIF_LETTER_ONLY.includes(type)) return control === controlLetter
  if (CIF_DIGIT_ONLY.includes(type)) return control === String(controlDigit)
  return control === String(controlDigit) || control === controlLetter
}

/** Any of the three Spanish forms. */
export function isValidSpanishTaxId(id: string): boolean {
  const v = normalizeVatId(id).replace(/^ES/, '')
  return checkSpanishNif(v) || checkSpanishNie(v) || checkSpanishCif(v)
}

// ─── Finland ─────────────────────────────────────────────────────────────────

/** Y-tunnus: 7 digits and a weighted mod-11 check digit. */
function checkFinnishBusinessId(id: string): boolean {
  const v = id.replace(/^FI/, '')
  if (!/^\d{8}$/.test(v)) return false

  const weights = [7, 9, 10, 5, 8, 4, 2]
  const sum = weights.reduce((acc, w, i) => acc + w * Number(v[i]), 0)
  const remainder = sum % 11

  // A remainder of 1 yields no valid check digit, so such ids are never issued.
  if (remainder === 1) return false
  const check = remainder === 0 ? 0 : 11 - remainder
  return check === Number(v[7])
}

// ─── The rest of the EU: shape only ──────────────────────────────────────────

/**
 * Format patterns, applied after the country prefix is stripped. Deliberately
 * shape-only: implementing a dozen national checksums we cannot test against
 * real ids would give false confidence, and `unchecked` says so honestly.
 */
const EU_VAT_SHAPES: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^0\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  FR: /^[0-9A-Z]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-Z]{1,2}|\d[A-Z+*]\d{5}[A-Z])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
}

// ─── The entry point ─────────────────────────────────────────────────────────

/**
 * Validate a tax identifier for a country.
 *
 * `country` is the issuer's own country (ISO-3166 alpha-2), not a prefix parsed
 * out of the id — an id may or may not carry one, and the partner's country is
 * the thing we actually know.
 *
 * An unknown country returns `unchecked` rather than `invalid`: we have no rule
 * for it, and calling something invalid because WE cannot check it would be a
 * lie that blocks a legitimate partner.
 */
export function validateVatId(
  raw: string | null | undefined,
  country: string | null | undefined,
): VatIdResult {
  const normalized = normalizeVatId(raw)
  if (normalized === '') {
    return { status: 'missing', normalized: '', error: null }
  }

  const cc = (country ?? '').trim().toUpperCase()

  if (cc === 'ES') {
    return isValidSpanishTaxId(normalized)
      ? { status: 'valid', normalized, error: null }
      : {
          status: 'invalid',
          normalized,
          error:
            'Not a valid Spanish NIF, NIE or CIF. Check the number and its control character.',
        }
  }

  if (cc === 'FI') {
    return checkFinnishBusinessId(normalized)
      ? { status: 'valid', normalized, error: null }
      : {
          status: 'invalid',
          normalized,
          error: 'Not a valid Finnish business ID (Y-tunnus).',
        }
  }

  const shape = cc ? EU_VAT_SHAPES[cc] : undefined
  if (shape) {
    const body = normalized.replace(new RegExp(`^${cc}`), '')
    return shape.test(body)
      ? { status: 'unchecked', normalized, error: null }
      : {
          status: 'invalid',
          normalized,
          error: `Does not look like a ${cc} VAT number.`,
        }
  }

  // No rule for this country. Say so rather than guess in either direction.
  return { status: 'unchecked', normalized, error: null }
}

/**
 * Is this identifier good enough to stamp on an invoice that will be
 * transmitted to a tax authority?
 *
 * `unchecked` counts as usable — we simply have no rule for that country, and
 * refusing on that basis would block partners for our own ignorance. Only a
 * value that FAILED a rule we do have, or one that is absent, is not usable.
 */
export function isUsableVatId(result: VatIdResult): boolean {
  return result.status === 'valid' || result.status === 'unchecked'
}
