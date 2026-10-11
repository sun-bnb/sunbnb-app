/**
 * Partner-account field rules shared by the Account form (`submitForm`, full replace) and the
 * field-level patch (`updateAccountFields`, track 030 S3). One place for limits, format checks and
 * the tax-id recording, so the two writers cannot disagree about what a valid account looks like.
 *
 * Deliberately NOT here: bank account / IBAN, payment provider, Stripe / KYC, Verifactu — the patch
 * never touches them (track 030 D3); they have their own gated flows.
 */
import prisma from '@repo/data/PrismaCient'
import { validateVatId } from '@repo/data/vat-id'

/** The only account fields a patch may write. */
export const ACCOUNT_PATCH_FIELDS = [
  'company', 'businessId', 'address', 'city', 'postalCode', 'country', 'phoneNumber', 'email', 'websiteUrl',
] as const
export type AccountPatchField = (typeof ACCOUNT_PATCH_FIELDS)[number]
export type AccountPatch = Partial<Record<AccountPatchField, string>>

export const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  firstName: 'First name', lastName: 'Last name', email: 'Email',
  phoneNumber: 'Phone number', company: 'Company name', address: 'Address',
  city: 'City', postalCode: 'Postal code', country: 'Country',
  businessId: 'Business ID', websiteUrl: 'Website',
}

export const ACCOUNT_STRING_LIMITS: Record<string, number> = {
  firstName: 100, lastName: 100, email: 320, phoneNumber: 50,
  company: 200, businessId: 50, websiteUrl: 2000,
  address: 300, city: 100, postalCode: 20, country: 100, bankAccount: 50,
}

/** Fields the form requires non-empty (the patch may not blank them either). */
export const ACCOUNT_REQUIRED_FIELDS = [
  'firstName', 'lastName', 'email', 'phoneNumber', 'company', 'address', 'city', 'postalCode', 'country', 'businessId',
] as const

/**
 * Length caps, then email format, then URL format — the first failure, or null. Fields the getter
 * reports as empty/absent are skipped (required-ness is the caller's concern).
 */
export function validateAccountFormats(get: (field: string) => string | null | undefined): string | null {
  for (const [field, max] of Object.entries(ACCOUNT_STRING_LIMITS)) {
    const val = get(field)
    if (val && val.length > max) return `${ACCOUNT_FIELD_LABELS[field] ?? field} is too long (max ${max} characters)`
  }
  const email = get('email')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format'
  const websiteUrl = get('websiteUrl')
  if (websiteUrl) {
    try {
      new URL(websiteUrl)
    } catch {
      return 'Invalid website URL'
    }
  }
  return null
}

/** Errors for a patch (empty = valid): known fields only, strings, required fields not blanked. */
export function validatePatch(patch: Record<string, unknown>): string[] {
  const errors: string[] = []
  const keys = Object.keys(patch)
  if (keys.length === 0) return ['Nothing to update']
  for (const key of keys) {
    if (!(ACCOUNT_PATCH_FIELDS as readonly string[]).includes(key)) errors.push(`Field not allowed: ${key}`)
    else if (typeof patch[key] !== 'string') errors.push(`${ACCOUNT_FIELD_LABELS[key] ?? key} must be text`)
  }
  if (errors.length > 0) return errors
  for (const key of keys) {
    const v = (patch[key] as string).trim()
    if (!v && (ACCOUNT_REQUIRED_FIELDS as readonly string[]).includes(key)) {
      errors.push(`${ACCOUNT_FIELD_LABELS[key] ?? key} is required`)
    }
  }
  if (errors.length > 0) return errors
  const formatError = validateAccountFormats((f) => (typeof patch[f] === 'string' ? (patch[f] as string).trim() : null))
  return formatError ? [formatError] : []
}

/**
 * Validate the tax id and RECORD the verdict — never reject the save on it (see `submitForm`: a venue
 * that cannot finish onboarding over a checksum sells un-invoiced, a worse outcome than a flagged id).
 */
export function taxIdentityFor(businessId: string, country: string | null | undefined) {
  const vatCheck = validateVatId(businessId, country ?? '')
  return {
    businessId: vatCheck.normalized || businessId,
    vatIdStatus: vatCheck.status,
    vatIdCheckedAt: new Date(),
  }
}

export interface AccountSnapshot {
  /** Prior values of every column the patch wrote (`null` = was empty). */
  values: Record<string, string | null>
  /** Present when the tax identity was re-recorded; restored verbatim on undo. */
  taxIdentity?: { businessId: string | null; vatIdStatus: string | null; vatIdCheckedAt: string | null }
}

const COLUMNS = {
  company: true, businessId: true, address: true, city: true, postalCode: true, country: true,
  phoneNumber: true, email: true, websiteUrl: true, vatIdStatus: true, vatIdCheckedAt: true,
} as const

/**
 * Field-level account update for `accountId`. NO authorization here — callers (the session action, or
 * the assistant's apply after it re-authorised the site owner) own that.
 */
export async function applyAccountPatch(
  accountId: string,
  patch: Record<string, unknown>,
): Promise<{ status: 'ok'; snapshot: AccountSnapshot } | { status: 'error'; errors: string[] }> {
  const errors = validatePatch(patch)
  if (errors.length > 0) return { status: 'error', errors }

  const account = await prisma.partnerAccount.findUnique({ where: { userId: accountId }, select: COLUMNS })
  if (!account) return { status: 'error', errors: ['Complete your account details on the Account page first'] }

  const clean: Record<string, string | null> = {}
  const values: Record<string, string | null> = {}
  for (const key of Object.keys(patch)) {
    const v = (patch[key] as string).trim()
    clean[key] = v === '' ? null : v
    values[key] = ((account as Record<string, unknown>)[key] as string | null | undefined) ?? null
  }

  const snapshot: AccountSnapshot = { values }
  const data: Record<string, unknown> = { ...clean }
  if ('businessId' in clean || 'country' in clean) {
    const businessId = ('businessId' in clean ? clean.businessId : account.businessId) ?? ''
    const country = 'country' in clean ? clean.country : account.country
    const identity = taxIdentityFor(businessId, country)
    Object.assign(data, identity)
    snapshot.taxIdentity = {
      businessId: account.businessId ?? null,
      vatIdStatus: account.vatIdStatus ?? null,
      vatIdCheckedAt: account.vatIdCheckedAt?.toISOString() ?? null,
    }
  }

  await prisma.partnerAccount.update({ where: { userId: accountId }, data })
  return { status: 'ok', snapshot }
}

/** Put back exactly what `applyAccountPatch` recorded (no re-validation: prior values were already there). */
export async function restoreAccountFields(accountId: string, snapshot: AccountSnapshot): Promise<void> {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(snapshot.values)) {
    if ((ACCOUNT_PATCH_FIELDS as readonly string[]).includes(k)) data[k] = v
  }
  if (snapshot.taxIdentity) {
    data.businessId = snapshot.taxIdentity.businessId
    data.vatIdStatus = snapshot.taxIdentity.vatIdStatus
    data.vatIdCheckedAt = snapshot.taxIdentity.vatIdCheckedAt ? new Date(snapshot.taxIdentity.vatIdCheckedAt) : null
  }
  await prisma.partnerAccount.update({ where: { userId: accountId }, data })
}
