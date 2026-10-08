'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  acceptTos,
  attachExternalAccount,
  createConnectedAccount,
  retrieveAccountSnapshot,
  snapshotToColumns,
  updateBusinessProfile,
  type AccountSnapshot,
  type BusinessProfileInput,
} from '@repo/data/stripe'
import { syncEffectiveProviderSafe } from '@/app/api/_lib/sync-effective-provider'

export type StripeActionResult =
  | { status: 'ok'; snapshot: AccountSnapshot }
  | { status: 'error'; errors: string[] }

const NOT_AUTH: StripeActionResult = { status: 'error', errors: ['Not authenticated'] }
const NOT_STARTED: StripeActionResult = { status: 'error', errors: ['Start Stripe onboarding first'] }
const GENERIC: StripeActionResult = {
  status: 'error',
  errors: ['Something went wrong talking to Stripe. Please try again.'],
}

async function persist(userId: string, snapshot: AccountSnapshot, extra: Record<string, unknown> = {}) {
  await prisma.partnerAccount.update({
    where: { userId },
    data: { ...snapshotToColumns(snapshot), ...extra },
  })
  await syncEffectiveProviderSafe(userId)
  revalidatePath('/account/stripe')
}

async function getAccountId(userId: string): Promise<string | null> {
  const account = await prisma.partnerAccount.findUnique({
    where: { userId },
    select: { stripeConnectAccountId: true },
  })
  return account?.stripeConnectAccountId ?? null
}

/** Create the Connect account, or resume (re-read) an existing one. Never creates twice. */
export async function startStripeOnboarding(
  businessType: 'company' | 'individual',
): Promise<StripeActionResult> {
  const session = await auth()
  if (!session?.user?.id) return NOT_AUTH
  const userId = session.user.id
  if (businessType !== 'company' && businessType !== 'individual') {
    return { status: 'error', errors: ['Invalid business type'] }
  }

  try {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId },
      select: { stripeConnectAccountId: true, country: true, email: true },
    })
    if (!account) return { status: 'error', errors: ['No partner account found'] }

    if (account.stripeConnectAccountId) {
      const snapshot = await retrieveAccountSnapshot(account.stripeConnectAccountId)
      await persist(userId, snapshot)
      return { status: 'ok', snapshot }
    }

    if (!account.country) return { status: 'error', errors: ['Set your business country in Account first'] }
    const email = account.email || session.user.email
    if (!email) return { status: 'error', errors: ['An email address is required'] }

    const { accountId } = await createConnectedAccount({
      partnerAccountId: userId,
      country: account.country,
      email,
      businessType,
    })
    const snapshot = await retrieveAccountSnapshot(accountId)
    await persist(userId, snapshot, {
      stripeConnectAccountId: accountId,
      stripeConnectConnectedAt: new Date(),
    })
    return { status: 'ok', snapshot }
  } catch (err) {
    console.error('[Stripe] start onboarding failed:', err)
    return GENERIC
  }
}

const nonEmpty = z.string().trim().min(1).max(200)
const addressSchema = z.object({
  line1: nonEmpty,
  city: nonEmpty,
  postal_code: nonEmpty,
  country: z.string().length(2),
})
const dobSchema = z.object({
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(1900).max(new Date().getFullYear() - 16),
})
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number')
const nationalitySchema = z
  .string()
  .trim()
  .length(2)
  .transform((v) => v.toUpperCase())
  .optional()
const ownerBase = {
  first_name: nonEmpty,
  last_name: nonEmpty,
  email: z.string().trim().email(),
  dob: dobSchema,
  address: addressSchema,
  nationality: nationalitySchema,
}
const personBase = {
  ...ownerBase,
  phone: phoneSchema,
  id_number: z.string().trim().max(60).optional(),
}
const profileSchema = z.object({
  businessType: z.enum(['company', 'individual']),
  company: z
    .object({
      name: nonEmpty,
      tax_id: z.string().trim().max(60).optional(),
      phone: phoneSchema,
      address: addressSchema,
    })
    .optional(),
  individual: z.object(personBase).optional(),
  representative: z
    .object({
      ...personBase,
      title: nonEmpty.max(100),
      owner: z.boolean().optional(),
      percent_ownership: z.number().min(0).max(100).optional(),
    })
    .optional(),
  // Additional beneficial owners (company only). A representative who is the sole owner
  // (representative.owner) needs none; the data layer then sets owners_provided.
  owners: z
    .array(z.object({ ...ownerBase, percent_ownership: z.number().min(0).max(100).optional() }))
    .max(4)
    .optional(),
  mcc: z.string().regex(/^\d{4}$/).optional(),
  url: z.string().url().optional(),
  productDescription: z.string().max(500).optional(),
})

export async function submitStripeBusinessProfile(input: BusinessProfileInput): Promise<StripeActionResult> {
  const session = await auth()
  if (!session?.user?.id) return NOT_AUTH
  const userId = session.user.id

  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 'error', errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  }
  const data = parsed.data
  if (data.businessType === 'company' && (!data.company || !data.representative)) {
    return { status: 'error', errors: ['Company details and a representative are required'] }
  }
  if (data.businessType === 'individual' && !data.individual) {
    return { status: 'error', errors: ['Individual details are required'] }
  }

  try {
    const accountId = await getAccountId(userId)
    if (!accountId) return NOT_STARTED
    const snapshot = await updateBusinessProfile(accountId, {
      ...data,
      ...(data.url
        ? {}
        : { productDescription: data.productDescription ?? 'Beach club sunbed and service reservations via Sunbnb' }),
    })
    await persist(userId, snapshot)
    return { status: 'ok', snapshot }
  } catch (err) {
    console.error('[Stripe] business profile failed:', err)
    return GENERIC
  }
}

const bankSchema = z.union([
  z.object({ token: z.string().trim().min(1).max(200) }),
  z.object({
    iban: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .refine((v) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v), 'Invalid IBAN'),
    accountHolderName: nonEmpty,
  }),
])

export async function submitStripeBankAccount(
  input: { token: string } | { iban: string; accountHolderName: string },
): Promise<StripeActionResult> {
  const session = await auth()
  if (!session?.user?.id) return NOT_AUTH
  const userId = session.user.id

  const parsed = bankSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 'error', errors: parsed.error.issues.map((i) => i.message) }
  }

  try {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId },
      select: { stripeConnectAccountId: true, country: true },
    })
    if (!account?.stripeConnectAccountId) return NOT_STARTED
    const data = parsed.data
    const snapshot = await attachExternalAccount(
      account.stripeConnectAccountId,
      'token' in data
        ? { token: data.token }
        : {
            iban: data.iban,
            accountHolderName: data.accountHolderName,
            country: account.country ?? data.iban.slice(0, 2),
            currency: 'eur',
          },
    )
    await persist(userId, snapshot)
    return { status: 'ok', snapshot }
  } catch (err) {
    console.error('[Stripe] bank account failed:', err)
    return GENERIC
  }
}

export async function acceptStripeTerms(): Promise<StripeActionResult> {
  const session = await auth()
  if (!session?.user?.id) return NOT_AUTH
  const userId = session.user.id

  try {
    const accountId = await getAccountId(userId)
    if (!accountId) return NOT_STARTED
    const h = await headers()
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || '0.0.0.0'
    const userAgent = h.get('user-agent') ?? 'unknown'
    const now = Date.now()
    const snapshot = await acceptTos(accountId, { date: Math.floor(now / 1000), ip, userAgent })
    await persist(userId, snapshot, { stripeConnectTosAcceptedAt: new Date(now) })
    return { status: 'ok', snapshot }
  } catch (err) {
    console.error('[Stripe] accept terms failed:', err)
    return GENERIC
  }
}

export async function refreshStripeStatus(): Promise<StripeActionResult> {
  const session = await auth()
  if (!session?.user?.id) return NOT_AUTH
  const userId = session.user.id

  try {
    const accountId = await getAccountId(userId)
    if (!accountId) return NOT_STARTED
    const snapshot = await retrieveAccountSnapshot(accountId)
    await persist(userId, snapshot)
    return { status: 'ok', snapshot }
  } catch (err) {
    console.error('[Stripe] status refresh failed:', err)
    return GENERIC
  }
}

/**
 * Clears the local link only. The Stripe account is deliberately NOT deleted/rejected:
 * it may hold balance, payouts in flight or KYC state, and reconnecting should be able
 * to resume it rather than re-onboard from scratch.
 */
export async function disconnectStripe(): Promise<{ status: 'ok' } | { status: 'error'; errors: string[] }> {
  const session = await auth()
  if (!session?.user?.id) return { status: 'error', errors: ['Not authenticated'] }
  const userId = session.user.id

  try {
    await prisma.partnerAccount.update({
      where: { userId },
      data: {
        stripeConnectAccountId: null,
        stripeConnectChargesEnabled: false,
        stripeConnectPayoutsEnabled: false,
        stripeConnectDetailsSubmitted: false,
        stripeConnectOnboardingStatus: null,
        stripeConnectRequirementsDue: [],
        stripeConnectTosAcceptedAt: null,
        stripeConnectConnectedAt: null,
      },
    })
    await syncEffectiveProviderSafe(userId)
    revalidatePath('/account/stripe')
    return { status: 'ok' }
  } catch (err) {
    console.error('[Stripe] disconnect failed:', err)
    return { status: 'error', errors: GENERIC.status === 'error' ? GENERIC.errors : [] }
  }
}
