/**
 * The `SistemaInformatico` block RD 1007/2023 requires on every record — who
 * produced the software that generated it (track 026 phase 5).
 *
 * PURE. No prisma, no database read.
 *
 * ## Why these are constants and not configuration
 *
 * The block identifies THIS build of Sunbnb as the producer. A deployment that
 * could change it from a database row is a deployment that could file records
 * under someone else's identity, so it is compiled in. `version` comes from an
 * env var only because it changes per release, and is the one field a
 * deployment is supposed to move.
 *
 * ## Relationship to the declaración responsable (D4)
 *
 * The declaration DESCRIBES the system — its type, composition, functionality
 * and installation characteristics — it does not assign these identifiers. We
 * choose them; the declaration must then describe what we chose. So this file
 * does not wait on the signature, but the two must be kept consistent: if
 * `nombreSistemaInformatico` or `idSistemaInformatico` change here, the signed
 * declaration is out of date.
 */

export interface SistemaInformatico {
  /** Legal name of the producer. */
  nombreRazon: string
  /** Producer's tax id. */
  nif: string
  /** Commercial name of the system. */
  nombreSistemaInformatico: string
  /**
   * The producer's own id for this system, where a producer ships more than
   * one. Sunbnb is one system, so this is fixed.
   */
  idSistemaInformatico: string
  /** Version of the software that generated the record. */
  version: string
  /**
   * Which installation generated it. Sunbnb is a single multi-tenant
   * installation — every partner's records come from the same running system,
   * not from a copy deployed at each venue — so this is one value rather than
   * one per customer.
   */
  numeroInstalacion: string
}

/** Sunbnb España SL, from the legal page and the platform Settings row. */
const PRODUCER_NAME = 'Sunbnb España SL'
const PRODUCER_NIF = 'B22435705'
const SYSTEM_NAME = 'Sunbnb'
const SYSTEM_ID = '01'
const INSTALLATION = '001'

/**
 * The block for this build.
 *
 * `version` falls back to `0.0.0-dev` rather than throwing: a missing version
 * must not stop a venue invoicing, and a record carrying an obviously fake
 * version is easier to find later than no record at all.
 */
export function sistemaInformatico(
  env: Record<string, string | undefined> = process.env,
): SistemaInformatico {
  return {
    nombreRazon: PRODUCER_NAME,
    nif: PRODUCER_NIF,
    nombreSistemaInformatico: SYSTEM_NAME,
    idSistemaInformatico: SYSTEM_ID,
    version: env.VERIFACTU_SYSTEM_VERSION ?? '0.0.0-dev',
    numeroInstalacion: INSTALLATION,
  }
}

/**
 * Where the PLATFORM's own commission invoices are filed.
 *
 * Sunbnb España SL is established in Fuengirola, Málaga — common territory, so
 * Veri*factu rather than TicketBAI.
 *
 * ## Why this is a FUNCTION of the issuer's tax id, not a constant
 *
 * It was a constant, and that was wrong. `getBusinessEntity()` reads a
 * `Settings` row, and there is more than one — the platform also has a Finnish
 * entity. Nothing stops a commission invoice being issued by it, and a constant
 * ES jurisdiction would then file a FINNISH company's invoice to the Spanish
 * agency, under a NIF AEAT has never heard of. The invoice does not carry an
 * issuer country column, so the tax id is the only thing that identifies which
 * of our own entities issued it.
 *
 * Anything other than the Spanish entity's NIF therefore resolves to no
 * jurisdiction, which `resolveTaxRegime` reads as out of scope: an invoice from
 * a group entity we have not classified is not filed anywhere, rather than
 * filed in the wrong place.
 */
export const PLATFORM_ES_ISSUER_NIF = PRODUCER_NIF

/** Fold a tax id for comparison: case, spaces, punctuation and a country prefix. */
function foldNif(value: string | null | undefined): string {
  const bare = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return bare.startsWith('ES') ? bare.slice(2) : bare
}

export function platformIssuerJurisdiction(issuerVatNumber: string | null | undefined): {
  country: string | null
  taxRegion: string | null
} {
  return foldNif(issuerVatNumber) === foldNif(PLATFORM_ES_ISSUER_NIF)
    ? { country: 'ES', taxRegion: 'MA' }
    : { country: null, taxRegion: null }
}
