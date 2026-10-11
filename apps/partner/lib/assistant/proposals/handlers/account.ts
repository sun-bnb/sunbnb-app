/**
 * kind `account_fields` -- the company profile on the partner ACCOUNT (not the site). Only the
 * whitelisted contact / legal fields: never the bank account / IBAN, payment provider, Stripe / KYC
 * or Verifactu (track 030 D3). Written through `applyAccountPatch` (the same rules as the Account
 * form and the `updateAccountFields` action) for the SITE OWNER's account -- the engine has already
 * re-authorised the caller, so a sudo acting on a foreign site patches the owner, not themselves.
 */
import prisma from '@repo/data/PrismaCient'
import { validateVatId } from '@repo/data/vat-id'
import {
  ACCOUNT_FIELD_LABELS,
  ACCOUNT_PATCH_FIELDS,
  applyAccountPatch,
  restoreAccountFields,
  validatePatch,
  type AccountPatch,
  type AccountSnapshot,
} from '@/lib/account-fields'
import { ProposalError, norm, type Change, type Diff, type HandlerCtx, type KindHandler } from '../types'

export interface AccountPayload { fields: AccountPatch }

export function planAccountFields(input: Record<string, unknown>): { payload: AccountPayload } | { errors: string[] } {
  const fields: AccountPatch = {}
  for (const f of ACCOUNT_PATCH_FIELDS) {
    if (input[f] !== undefined) fields[f] = input[f] as string
  }
  const errors = validatePatch(fields)
  if (errors.length) return { errors }
  for (const f of Object.keys(fields) as (keyof AccountPatch)[]) fields[f] = fields[f]!.trim()
  return { payload: { fields } }
}

export const accountHandler: KindHandler<AccountPayload, AccountSnapshot> = {
  kind: 'account_fields',

  async diff(ctx: HandlerCtx, payload): Promise<Diff> {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId: ctx.accountId },
      select: {
        company: true, businessId: true, address: true, city: true, postalCode: true, country: true,
        phoneNumber: true, email: true, websiteUrl: true,
      },
    })
    if (!account) throw new ProposalError('The account details have not been completed yet: the user must fill in the Account page first')
    const cur = account as Record<string, string | null>
    const changes: Change[] = []
    const country = payload.fields.country ?? cur.country ?? ''
    for (const f of Object.keys(payload.fields) as (keyof AccountPatch)[]) {
      let after: string | null = payload.fields[f] ?? null
      // The tax id is stored in its normalised form (see taxIdentityFor): preview and compare that.
      if (f === 'businessId' && after) after = validateVatId(after, country).normalized || after
      if (norm(cur[f]) === norm(after)) continue
      changes.push({ target: 'Company account', field: f, label: ACCOUNT_FIELD_LABELS[f] ?? f, before: cur[f] ?? null, after })
    }
    const warnings: string[] = []
    if (changes.some((c) => c.field === 'businessId' || c.field === 'country')) {
      const businessId = payload.fields.businessId ?? cur.businessId ?? ''
      const check = validateVatId(businessId, country)
      warnings.push('The tax ID is printed on every invoice issued from now on; invoices already issued are not changed')
      if (check.status === 'invalid') warnings.push('This tax ID does not look valid for the country; it will still be saved but flagged for review')
    }
    return { changes, ...(warnings.length ? { warnings } : {}) }
  },

  async snapshot(ctx, payload) {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId: ctx.accountId },
      select: {
        company: true, businessId: true, address: true, city: true, postalCode: true, country: true,
        phoneNumber: true, email: true, websiteUrl: true, vatIdStatus: true, vatIdCheckedAt: true,
      },
    })
    const cur = (account ?? {}) as Record<string, unknown>
    const values: Record<string, string | null> = {}
    for (const f of Object.keys(payload.fields)) values[f] = (cur[f] as string | null | undefined) ?? null
    const out: AccountSnapshot = { values }
    if ('businessId' in payload.fields || 'country' in payload.fields) {
      out.taxIdentity = {
        businessId: (cur.businessId as string | null | undefined) ?? null,
        vatIdStatus: (cur.vatIdStatus as string | null | undefined) ?? null,
        vatIdCheckedAt: (cur.vatIdCheckedAt as Date | null | undefined)?.toISOString() ?? null,
      }
    }
    return out
  },

  async execute(ctx, payload, done) {
    const r = await applyAccountPatch(ctx.accountId, payload.fields as Record<string, unknown>)
    if (r.status !== 'ok') throw new ProposalError(r.errors[0] ?? 'Account update failed')
    done.push('account')
  },

  async restore(ctx, _payload, snapshot) {
    await restoreAccountFields(ctx.accountId, snapshot)
  },
}
