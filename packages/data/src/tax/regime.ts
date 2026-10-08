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
  /**
   * Spain, but a territory whose INDIRECT TAX is not IVA — the Canary Islands
   * (IGIC) and Ceuta/Melilla (IPSI).
   *
   * Separated from `ES_VERIFACTU` because a `Desglose` built here would carry
   * IGIC or IPSI rates, and `LEGAL_ES_VAT_RATES` is the IVA set — so such an
   * invoice would be refused downstream anyway, but for a confusing reason
   * ("not a legal Spanish rate") rather than the real one. Whether Veri*factu
   * applies in these territories at all, and how a non-IVA rate is declared, is
   * **D7** — unanswered, so nothing is filed.
   */
  | 'ES_INDIRECT_TAX_UNSUPPORTED'

/** Foral territories, by the province codes we store. */
const FORAL_REGIONS = new Set(['VI', 'BI', 'SS', 'NA'])

/** Territories under IGIC (Canarias) or IPSI (Ceuta, Melilla) rather than IVA. */
const NON_IVA_REGIONS = new Set(['GC', 'TF', 'CE', 'ML'])

/**
 * The Spanish provinces, by the two-letter codes in common use on tax
 * documents, with the name an operator will recognise.
 *
 * A CLOSED list, and that is the point. `resolveTaxRegime` used to treat any
 * non-empty, non-foral string as common territory, so `"BIZKAIA"`, `"Bilbao"`,
 * `"PV"` or a typo would all have resolved to `ES_VERIFACTU` and filed a foral
 * taxpayer's records to AEAT — the precise outcome `ES_FORAL_UNSUPPORTED`'s own
 * comment calls worse than filing nothing. The field is set by a human, so the
 * only safe reading of an unrecognised value is "unknown".
 */
export const ES_PROVINCES: { code: string; name: string }[] = [
  { code: 'A', name: 'Alicante' },
  { code: 'AB', name: 'Albacete' },
  { code: 'AL', name: 'Almería' },
  { code: 'AV', name: 'Ávila' },
  { code: 'B', name: 'Barcelona' },
  { code: 'BA', name: 'Badajoz' },
  { code: 'BI', name: 'Bizkaia' },
  { code: 'BU', name: 'Burgos' },
  { code: 'C', name: 'A Coruña' },
  { code: 'CA', name: 'Cádiz' },
  { code: 'CC', name: 'Cáceres' },
  { code: 'CE', name: 'Ceuta' },
  { code: 'CO', name: 'Córdoba' },
  { code: 'CR', name: 'Ciudad Real' },
  { code: 'CS', name: 'Castellón' },
  { code: 'CU', name: 'Cuenca' },
  { code: 'GC', name: 'Las Palmas' },
  { code: 'GI', name: 'Girona' },
  { code: 'GR', name: 'Granada' },
  { code: 'GU', name: 'Guadalajara' },
  { code: 'H', name: 'Huelva' },
  { code: 'HU', name: 'Huesca' },
  { code: 'J', name: 'Jaén' },
  { code: 'L', name: 'Lleida' },
  { code: 'LE', name: 'León' },
  { code: 'LO', name: 'La Rioja' },
  { code: 'LU', name: 'Lugo' },
  { code: 'M', name: 'Madrid' },
  { code: 'MA', name: 'Málaga' },
  { code: 'ML', name: 'Melilla' },
  { code: 'MU', name: 'Murcia' },
  { code: 'NA', name: 'Navarra' },
  { code: 'O', name: 'Asturias' },
  { code: 'OR', name: 'Ourense' },
  { code: 'P', name: 'Palencia' },
  { code: 'PM', name: 'Illes Balears' },
  { code: 'PO', name: 'Pontevedra' },
  { code: 'S', name: 'Cantabria' },
  { code: 'SA', name: 'Salamanca' },
  { code: 'SE', name: 'Sevilla' },
  { code: 'SG', name: 'Segovia' },
  { code: 'SO', name: 'Soria' },
  { code: 'SS', name: 'Gipuzkoa' },
  { code: 'T', name: 'Tarragona' },
  { code: 'TE', name: 'Teruel' },
  { code: 'TF', name: 'Santa Cruz de Tenerife' },
  { code: 'TO', name: 'Toledo' },
  { code: 'V', name: 'Valencia' },
  { code: 'VA', name: 'Valladolid' },
  { code: 'VI', name: 'Araba/Álava' },
  { code: 'Z', name: 'Zaragoza' },
  { code: 'ZA', name: 'Zamora' },
]

const ES_PROVINCE_CODES = new Set(ES_PROVINCES.map((p) => p.code))

/** Is this a province code we recognise? Case- and whitespace-insensitive. */
export function isKnownEsRegion(region: string | null | undefined): boolean {
  return ES_PROVINCE_CODES.has((region ?? '').trim().toUpperCase())
}

/**
 * Spanish postal codes start with the province's INE number (01–52), in the old
 * alphabetical order of province names. Indexed by that number; values are the
 * `ES_PROVINCES` codes above.
 */
const ES_PROVINCE_BY_INE: readonly string[] = [
  '', 'VI', 'AB', 'A', 'AL', 'AV', 'BA', 'PM', 'B', 'BU', 'CC', 'CA', 'CS', 'CR', 'CO', 'C', 'CU',
  'GI', 'GR', 'GU', 'SS', 'H', 'HU', 'J', 'LE', 'L', 'LO', 'LU', 'M', 'MA', 'MU', 'NA', 'OR', 'O',
  'P', 'GC', 'PO', 'SA', 'TF', 'S', 'SG', 'SE', 'SO', 'T', 'TE', 'TO', 'V', 'VA', 'BI', 'ZA', 'Z',
  'CE', 'ML',
]

/**
 * The province of a Spanish postal code (`29640` → `MA`), or null when it isn't a
 * five-digit code with a known province prefix. Used where a province is required
 * but the account only has an address — e.g. Stripe Terminal Locations in Spain
 * require `address.state` (track 028 P5, found against the live API).
 */
export function esProvinceFromPostalCode(postalCode: string | null | undefined): string | null {
  const m = (postalCode ?? '').trim().match(/^(\d{2})\d{3}$/)
  if (!m) return null
  return ES_PROVINCE_BY_INE[Number(m[1])] || null
}

/** What regime a province implies, for an operator UI to show the consequence. */
export function regimeForEsRegion(region: string | null | undefined): TaxRegime {
  return resolveTaxRegime({ country: 'ES', taxRegion: region })
}

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
  if (NON_IVA_REGIONS.has(region)) return 'ES_INDIRECT_TAX_UNSUPPORTED'
  // An UNRECOGNISED region is `NONE`, never Veri*factu. It used to fall through
  // to `ES_VERIFACTU`, which meant a hand-typed "BIZKAIA" or "Bilbao" filed a
  // foral taxpayer's records to AEAT. Unknown means unknown.
  if (!ES_PROVINCE_CODES.has(region)) return 'NONE'
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
  if ((issuer.country ?? '').trim().toUpperCase() !== 'ES') return false
  const region = (issuer.taxRegion ?? '').trim()
  // An unrecognised code needs an operator just as much as a blank one does, and
  // is more dangerous because it LOOKS set.
  return region === '' || !isKnownEsRegion(region)
}

/** Does this regime produce fiscal records that must be built and transmitted? */
export function regimeRequiresRecords(regime: TaxRegime): boolean {
  return regime === 'ES_VERIFACTU'
}
