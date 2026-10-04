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
  /**
   * `S` when the system can ONLY be used to issue verifiable invoices.
   *
   * Ours is `S`: we implement remisión and nothing else. There is no
   * NO VERI*FACTU mode in this codebase — no XAdES signing of records, no local
   * conservation, no registro de eventos — so a user could not operate it that
   * way even if they wanted to. Answering `N` would claim a capability we do not
   * have and would invite AEAT to expect an event log.
   */
  tipoUsoPosibleSoloVerifactu: 'S' | 'N'
  /**
   * `S` when the system is CAPABLE of serving several obligados tributarios.
   *
   * Ours is `S` — it is a multi-tenant SaaS platform by design.
   */
  tipoUsoPosibleMultiOT: 'S' | 'N'
  /**
   * `S` when this installation IS currently serving several obligados.
   *
   * Distinct from the field above: that one is about the software's capability,
   * this one about the running instance. Both are `S` for us, and they would
   * diverge for a single-tenant deployment of the same product.
   */
  indicadorMultiplesOT: 'S' | 'N'
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
    // All three are `S`, and all three describe the system rather than the
    // invoice — which is why they must stay consistent with the declaración
    // responsable (D4). Changing one here without amending the declaration makes
    // the declaration false.
    tipoUsoPosibleSoloVerifactu: 'S',
    tipoUsoPosibleMultiOT: 'S',
    indicadorMultiplesOT: 'S',
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
/**
 * Who we are when we issue an invoice **in a partner's name**.
 *
 * The beach operator is the Seller of Record; Sunbnb materially expedites the
 * invoice on their behalf under art. 6 RRSIF in relation to art. 5 ROF. That
 * fact has to appear in the record (`EmitidaPorTerceroODestinatario` = `T` plus
 * this block), because it is what distinguishes a partner's own invoices from
 * ones issued for them.
 *
 * Same company as the software producer above, deliberately spelled out
 * separately: they are different ROLES, and a future group restructuring could
 * split them.
 */
export const THIRD_PARTY_ISSUER = {
  nombreRazon: PRODUCER_NAME,
  nif: PRODUCER_NIF,
} as const

export const PLATFORM_ES_ISSUER_NIF = PRODUCER_NIF

/** Fold a tax id for comparison: case, spaces, punctuation and a country prefix. */
function foldNif(value: string | null | undefined): string {
  const bare = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return bare.startsWith('ES') ? bare.slice(2) : bare
}

/**
 * Every spelling of our own NIF that a stored record might carry.
 *
 * Needed because a database filter cannot fold a prefix the way `foldNif` does,
 * and the platform `Settings` row in test and production actually stores
 * `ESB22435705`. A sweep filtering on the bare NIF alone would match nothing and
 * report a clean, empty run.
 */
export function platformIssuerNifCandidates(): string[] {
  const bare = foldNif(PLATFORM_ES_ISSUER_NIF)
  return [bare, `ES${bare}`]
}

export function platformIssuerJurisdiction(issuerVatNumber: string | null | undefined): {
  country: string | null
  taxRegion: string | null
} {
  return foldNif(issuerVatNumber) === foldNif(PLATFORM_ES_ISSUER_NIF)
    ? { country: 'ES', taxRegion: 'MA' }
    : { country: null, taxRegion: null }
}

/**
 * Who we are when we **submit a partner's records** under colaboración social.
 *
 * This is the `Representante` in the `Cabecera`: the obligado is the partner,
 * and AEAT needs to know which authorised third party is doing the sending.
 * Omitted entirely when we are the obligado ourselves, because a representative
 * of oneself is not a thing.
 *
 * Third role, third constant, same company — following the reasoning already
 * given for `THIRD_PARTY_ISSUER`. The roles are genuinely distinct and rest on
 * different provisions: producer (RD 1007/2023), third-party issuer (art. 5
 * ROF), colaborador social (Convenio). A group restructuring could split them,
 * and folding them into one constant now would make that a search-and-replace
 * through code that reads as if it had only ever meant one thing.
 */
export const COLABORADOR_SOCIAL = {
  nombreRazon: PRODUCER_NAME,
  nif: PRODUCER_NIF,
} as const
