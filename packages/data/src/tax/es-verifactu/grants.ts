/**
 * The two authorisations a partner must give us (track 026 P7a).
 *
 * ## Why there are two, not one
 *
 * They are separate legal acts, they rest on different provisions, and they gate
 * different things — so a single "I agree to Veri*factu" flag would be a lie
 * about what was agreed.
 *
 *  1. **Invoicing authority** — art. 5 RD 1619/2012. The obligado authorises a
 *     third party to *expedite invoices in their name*. We already depend on
 *     this for every partner sale, and every record we build declares it
 *     (`EmitidaPorTerceroODestinatario = T`). Without it the declaration in the
 *     record is unsupported.
 *  2. **AEAT submission** — *colaboración social*. The obligado authorises
 *     Sunbnb to *submit their records*. AEAT is explicit: *"ningún colaborador
 *     social realice envíos sin estar previamente autorizado"*, and a submission
 *     without it is refused whole with `4112`.
 *
 * ## The gate is on SUBMISSION, not on generation
 *
 * A partner who has not granted yet still gets records generated — they are owed
 * regardless, and withholding them would create the gap phase 5 exists to avoid.
 * What waits is sending. Their records sit `pending`, which is the correct state
 * and is surfaced as "awaiting authorisation" rather than as a failure.
 *
 * They are deliberately NOT marked `blocked`: blocked is terminal-until-fixed
 * and stops retrying, whereas these should go out untouched the moment the grant
 * arrives.
 */

/**
 * Bump when the wording of what partners accept changes materially.
 *
 * Stored per grant so a later rewording does not retroactively claim a partner
 * agreed to text they never saw. A grant on an older version is still a grant —
 * deciding whether a change requires re-consent is a legal judgement, not
 * something to infer from a version mismatch.
 */
export const VERIFACTU_GRANT_TERMS_VERSION = '2026-10-03'

export interface PartnerGrants {
  invoicingAuthorityGrantedAt: Date | null
  aeatSubmissionGrantedAt: Date | null
  verifactuGrantTermsVersion: string | null
}

/** May we expedite invoices in this partner's name? (art. 5 ROF) */
export function mayIssueInvoicesFor(grants: PartnerGrants): boolean {
  return grants.invoicingAuthorityGrantedAt !== null
}

/** May we submit this partner's records to AEAT? (colaboración social) */
export function maySubmitRecordsFor(grants: PartnerGrants): boolean {
  return grants.aeatSubmissionGrantedAt !== null
}

export type GrantState = 'none' | 'invoicing-only' | 'complete'

export function grantState(grants: PartnerGrants): GrantState {
  const invoicing = mayIssueInvoicesFor(grants)
  const submission = maySubmitRecordsFor(grants)
  if (invoicing && submission) return 'complete'
  if (invoicing) return 'invoicing-only'
  return 'none'
}

/** One line for an operator. */
export function describeGrantState(state: GrantState): string {
  switch (state) {
    case 'complete':
      return 'Authorised to issue invoices and to submit records to AEAT.'
    case 'invoicing-only':
      return 'Authorised to issue invoices, but NOT to submit records — their records will be generated and queued, not sent.'
    case 'none':
      return 'No authorisation on file. We are issuing invoices in their name without a recorded mandate (art. 5 RD 1619/2012).'
  }
}

export interface GrantEvidence {
  /** The partner user who accepted. */
  acceptedByUserId: string
  acceptedByEmail: string | null
  /** When, as an ISO string — duplicated from the column so the blob stands alone. */
  acceptedAt: string
  ip: string | null
  userAgent: string | null
  termsVersion: string
}
