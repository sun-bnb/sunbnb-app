'use server'

import { grantLaunchPromotionIfEligible } from '@repo/data/promotion-db'
import { revalidatePath } from 'next/cache';
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  ACCOUNT_FIELD_LABELS,
  ACCOUNT_REQUIRED_FIELDS,
  applyAccountPatch,
  taxIdentityFor,
  validateAccountFormats,
  type AccountPatch,
} from '@/lib/account-fields'

export async function submitForm(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const requiredFields = ACCOUNT_REQUIRED_FIELDS
  const errors = requiredFields
    .filter(field => !formData.get(field))
    .map(field => `${ACCOUNT_FIELD_LABELS[field] ?? field} is required`)
  if (errors.length > 0) return { status: 'error', errors }

  // Length caps, email format, URL format (shared with the field patch below).
  const formatError = validateAccountFormats((field) => formData.get(field) as string | null)
  if (formatError) return { status: 'error', errors: [formatError] }

  const accountData = {
    userId: session.user.id,
    firstName: formData.get('firstName') as string,
    lastName: formData.get('lastName') as string,
    email: formData.get('email') as string,
    phoneNumber: formData.get('phoneNumber') as string,
    company: formData.get('company') as string,
    businessId: formData.get('businessId') as string,
    websiteUrl: formData.get('websiteUrl') as string,
    address: formData.get('address') as string,
    city: formData.get('city') as string,
    postalCode: formData.get('postalCode') as string,
    country: formData.get('country') as string,
    bankAccount: formData.get('bankAccount') as string
  }

  // Validate the tax id and RECORD the verdict — never reject the save on it.
  //
  // This id is stamped on every invoice as `issuerVatNumber` and fed into the
  // invoice hash, so junk there is baked into the partner's integrity chain
  // (production carries the literal string "Alonso Beach" as one). But refusing
  // the form would leave a venue unable to finish onboarding over a checksum,
  // and a venue that cannot onboard sells for cash without invoicing at all —
  // a worse outcome than a flagged id we can chase. Enforcement belongs at
  // transmission, where the remedy is "fix it and re-send".
  const taxIdentity = taxIdentityFor(accountData.businessId, accountData.country)
  Object.assign(accountData, taxIdentity)

  const account = await prisma.partnerAccount.findUnique({ where: { userId: session.user.id } })

  if (!account) {
    
    await prisma.partnerAccount.create({
      data: accountData
    })

    // Auto-assign STARTER subscription to new partner accounts
    const starterPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: 'STARTER' } })
    if (starterPlan) {
      await prisma.subscription.create({
        data: {
          partnerAccountId: session.user.id,
          planId: starterPlan.id,
          status: 'ACTIVE',
        },
      })
    }

    // Launch offer (track 027 D9): no commission or plan fees for 30 days from the first live
    // paid booking, for accounts created by the cut-off. Never allowed to block a signup.
    try {
      await grantLaunchPromotionIfEligible(session.user.id)
    } catch (err) {
      console.error('[account] launch promotion grant failed', err)
    }

    revalidatePath('/account')
    return { status: 'ok' }

  } else {

    await prisma.partnerAccount.update({
      data: accountData,
      where: {
        userId: account.userId
      }

    })

    revalidatePath('/account')
    return { status: 'ok' }

  }
  
}

/**
 * Field-level update of the session user's own PartnerAccount — only the fields in `patch`, unlike
 * `submitForm`'s 10-field replace (track 030 S3). Allowed: company, businessId, address, city,
 * postalCode, country, phoneNumber, email, websiteUrl. Never the bank account, payment provider,
 * Stripe/KYC or Verifactu. A businessId/country change re-records the tax-id verdict (never rejects).
 */
export async function updateAccountFields(
  patch: AccountPatch,
): Promise<{ status: string; errors?: string[] }> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const result = await applyAccountPatch(session.user.id, patch as Record<string, unknown>)
  if (result.status === 'error') return { status: 'error', errors: result.errors }

  revalidatePath('/account')
  return { status: 'ok' }
}
