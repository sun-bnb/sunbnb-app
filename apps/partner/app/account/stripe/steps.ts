/** Pure step-derivation for the Stripe Connect onboarding wizard (track 028, P3d). */

export type StripeStep = 'business-type' | 'details' | 'bank' | 'terms' | 'status'

export interface StripeColumns {
  stripeConnectAccountId: string | null
  stripeConnectRequirementsDue: string[]
}

export interface StepSnapshot {
  currentlyDue: string[]
  pastDue?: string[]
}

export type RequirementGroup = 'details' | 'bank' | 'terms' | 'verification'

/** Which wizard step can satisfy a Stripe requirement key. */
export function requirementGroup(key: string): RequirementGroup {
  if (key.startsWith('tos_acceptance')) return 'terms'
  if (key.startsWith('external_account')) return 'bank'
  // Identity documents / verification files are collected by the embedded account management
  // component, not by our form wizard.
  if (/\.verification\.(document|additional_document)/.test(key)) return 'verification'
  return 'details'
}

export function dueRequirements(columns: StripeColumns, snapshot?: StepSnapshot | null): string[] {
  const list = snapshot
    ? [...snapshot.currentlyDue, ...(snapshot.pastDue ?? [])]
    : columns.stripeConnectRequirementsDue
  return Array.from(new Set(list))
}

export function currentStep(columns: StripeColumns, snapshot?: StepSnapshot | null): StripeStep {
  if (!columns.stripeConnectAccountId) return 'business-type'
  const groups = new Set(dueRequirements(columns, snapshot).map(requirementGroup))
  if (groups.has('details')) return 'details'
  if (groups.has('bank')) return 'bank'
  if (groups.has('terms')) return 'terms'
  return 'status'
}

/** Wizard step that resolves a requirement (verification items live on the status step). */
export function stepForRequirement(key: string): StripeStep {
  const g = requirementGroup(key)
  return g === 'verification' ? 'status' : g
}

/** i18n key (under `StripeConnect`) for a friendly requirement label, or null for unknown keys. */
export function requirementLabelKey(key: string): string | null {
  if (key.startsWith('tos_acceptance')) return 'reqTos'
  if (key.startsWith('external_account')) return 'reqExternalAccount'
  if (/\.verification\.(document|additional_document)/.test(key)) return 'reqDocument'
  if (key === 'company.owners_provided' || key.startsWith('owners.')) return 'reqOwners'
  if (key.endsWith('.nationality')) return 'reqNationality'
  if (key.endsWith('.phone')) return 'reqPhone'
  if (key === 'representative.relationship.title') return 'reqJobTitle'
  if (key === 'business_profile.mcc') return 'reqMcc'
  if (key === 'business_profile.url') return 'reqUrl'
  if (key.startsWith('representative.') || key.startsWith('person_')) return 'reqRepresentative'
  if (key === 'company.tax_id' || key === 'company.vat_id') return 'reqTaxId'
  if (key.startsWith('company.')) return 'reqCompany'
  if (key.startsWith('individual.')) return 'reqIndividual'
  if (key.startsWith('business_profile.')) return 'reqBusinessProfile'
  if (key === 'business_type') return 'reqBusinessType'
  return null
}
