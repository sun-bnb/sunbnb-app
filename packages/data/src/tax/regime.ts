/**
 * Which fiscal regime an ISSUER falls under (track 026).
 *
 * PURE — no prisma, no network.
 *
 * ## What this seam promises, and what it does not
 *
 * It promises exactly one thing: a single call site can ask "does this issuer's
 * regime require a fiscal record, and which one", instead of `payment.ts`
 * growing an `if (country === 'ES')`.
 *
 * It does NOT promise a multi-regime framework. There is one regime with an
 * implementation. Building a generic XML mapper, a per-regime config table or a
 * plugin registry on a single example would be inventing requirements we cannot
 * check. When a second regime lands — TicketBAI, Portugal's ATCUD, Italy's SdI —
 * the expectation is a second CONCRETE module beside `es-verifactu/` and a
 * widened union here. Two examples, then refactor.
 *
 * **Do not generalise this file.** If you are here because you are about to add
 * an abstraction "while you're at it", that is the thing this comment exists to
 * stop.
 */

export type TaxRegime =
  /**
   * No fiscal record is produced. Every non-Spanish issuer today, and any
   * issuer whose jurisdiction we cannot determine.
   */
  | 'NONE'
  /** Spain, common territory — RD 1007/2023 (Veri*factu). */
  | 'ES_VERIFACTU'
  /**
   * Spain, foral territory — Basque Country (Araba/Bizkaia/Gipuzkoa) or
   * Navarra. These fall under TicketBAI and its Navarrese equivalent, NOT
   * Veri*factu: a different regime, a different QR and a different web service.
   *
   * Named rather than silently folded into `ES_VERIFACTU` because submitting a
   * foral taxpayer's records to the wrong tax agency is worse than submitting
   * none. Nothing implements it; a partner here gets no records and an operator
   * warning.
   */
  | 'ES_FORAL_UNSUPPORTED'

/** Foral territories, by the ISO-3166-2 province codes we store. */
const FORAL_REGIONS = new Set(['VI', 'BI', 'SS', 'NA'])

export interface RegimeIssuer {
  /** ISO-3166 alpha-2 of the issuing entity's tax residence. */
  country: string | null | undefined
  /**
   * Province/region within that country, where it changes the regime.
   *
   * Set explicitly by an operator — NEVER geocoded from a venue's coordinates.
   * A beach club's location does not determine its *domicilio fiscal*: the
   * company's registered address does, and a Bilbao company can run a venue in
   * Málaga. Guessing it from a map pin would file a partner's records with the
   * wrong authority while looking entirely reasonable.
   */
  taxRegion?: string | null
}

/**
 * Resolve an issuer's regime.
 *
 * Spain with an UNSET region resolves to `NONE`, not to Veri*factu. That is the
 * safe direction: the cost of not submitting is a late filing with a defined
 * remedy, while the cost of submitting to the wrong agency is a filing that has
 * to be unwound. An operator warning is the right way to close the gap — see
 * `needsTaxRegion`.
 */
export function resolveTaxRegime(issuer: RegimeIssuer): TaxRegime {
  const country = (issuer.country ?? '').trim().toUpperCase()
  if (country !== 'ES') return 'NONE'

  const region = (issuer.taxRegion ?? '').trim().toUpperCase()
  if (region === '') return 'NONE'
  if (FORAL_REGIONS.has(region)) return 'ES_FORAL_UNSUPPORTED'
  return 'ES_VERIFACTU'
}

/**
 * Is this issuer one an operator must still classify?
 *
 * True for a Spanish issuer with no region set — it is in scope of a Spanish
 * regime but we cannot say which, so it is producing no records when it should
 * be producing some. Surfaced in the admin fleet view rather than blocking
 * anything.
 */
export function needsTaxRegion(issuer: RegimeIssuer): boolean {
  return (
    (issuer.country ?? '').trim().toUpperCase() === 'ES' &&
    (issuer.taxRegion ?? '').trim() === ''
  )
}

/** Does this regime produce fiscal records that must be built and transmitted? */
export function regimeRequiresRecords(regime: TaxRegime): boolean {
  return regime === 'ES_VERIFACTU'
}
