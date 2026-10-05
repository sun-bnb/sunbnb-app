'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'
import { SUBSCRIPTION_FEATURES } from '@repo/data/subscription'
import {
  saveServiceFee,
  getFeesByAccount,
} from '../../fees/actions'
import { isKnownEsRegion, resolveTaxRegime, type TaxRegime } from '@repo/data/tax/regime'
import { grantLaunchPromotion, revokeLaunchPromotion } from '@repo/data/promotion-db'

// ─── Auth guard ─────────────────────────────────────────────────────────────

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
  return session
}

// ─── Upsert custom subscription ─────────────────────────────────────────────

export async function upsertCustomSubscription(
  accountId: string,
  input: { maxSites: number | null; notes?: string },
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  const { maxSites, notes } = input

  if (maxSites !== null) {
    if (!Number.isInteger(maxSites) || maxSites < 0) {
      return {
        status: 'error',
        errors: ['maxSites must be null or a non-negative integer'],
      }
    }
  }

  await prisma.customSubscription.upsert({
    where: { partnerAccountId: accountId },
    create: {
      partnerAccountId: accountId,
      maxSites: maxSites ?? null,
      notes: notes?.trim() || null,
    },
    update: {
      maxSites: maxSites ?? null,
      notes: notes?.trim() || null,
    },
  })

  revalidatePath(`/partners/${accountId}`, 'page')
  return { status: 'ok' }
}

// ─── Clear custom subscription (reset to base plan) ─────────────────────────

export async function clearCustomSubscription(
  accountId: string,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  await prisma.customSubscription.deleteMany({
    where: { partnerAccountId: accountId },
  })

  revalidatePath(`/partners/${accountId}`, 'page')
  return { status: 'ok' }
}

// ─── Waive all service fees (set every code to 0%) ──────────────────────────

export async function waiveAllServiceFees(
  accountId: string,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  // Load all service codes
  const serviceCodes = await prisma.serviceCode.findMany({
    orderBy: { code: 'asc' },
  })

  if (serviceCodes.length === 0) {
    return { status: 'ok' } // nothing to do
  }

  // Resolve the Settings row for this partner (by country, with fallback)
  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: accountId },
    select: { country: true },
  })

  let settings: { id: string } | null = null
  if (partnerAccount?.country) {
    settings = await prisma.settings.findFirst({
      where: { country: partnerAccount.country },
      select: { id: true },
    })
  }
  if (!settings) {
    settings = await prisma.settings.findFirst({ select: { id: true } })
  }
  if (!settings) {
    return { status: 'error', errors: ['No Settings configured'] }
  }

  const settingsId = settings.id

  // Load existing account fees (keyed by serviceCode) for idempotent upsert
  const existingFees = await getFeesByAccount(accountId)
  const feeByCode = new Map(existingFees.map((f) => [f.serviceCode, f]))

  // For each service code, upsert a 0% account fee
  for (const sc of serviceCodes) {
    const existing = feeByCode.get(sc.code)
    await saveServiceFee({
      id: existing?.id,
      settingsId,
      accountId,
      chargeType: 'percentage',
      percentage: 0,
      serviceCode: sc.code,
    })
  }

  revalidatePath(`/partners/${accountId}`, 'page')
  return { status: 'ok' }
}

// ─── Set feature override ─────────────────────────────────────────────────────

export async function setFeatureOverride(
  accountId: string,
  featureKey: string,
  value: boolean | null,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!(featureKey in SUBSCRIPTION_FEATURES)) {
    return { status: 'error', errors: [`Unknown feature key: ${featureKey}`] }
  }

  const existing = await prisma.customSubscription.findUnique({
    where: { partnerAccountId: accountId },
    select: { featureOverrides: true },
  })

  const nextMap: Record<string, boolean> = {
    ...((existing?.featureOverrides as Record<string, boolean>) ?? {}),
  }

  if (value === null) {
    delete nextMap[featureKey]
  } else {
    nextMap[featureKey] = value
  }

  await prisma.customSubscription.upsert({
    where: { partnerAccountId: accountId },
    create: { partnerAccountId: accountId, featureOverrides: nextMap },
    update: { featureOverrides: nextMap },
  })

  revalidatePath(`/partners/${accountId}`, 'page')
  return { status: 'ok' }
}

// ─── Get partner detail (for client refetch after mutations) ─────────────────

export async function getPartnerDetail(accountId: string) {
  await requireSudo()

  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: accountId },
    select: {
      userId: true,
      company: true,
      firstName: true,
      lastName: true,
      country: true,
      subscription: {
        include: { plan: true },
      },
      customSubscription: true,
      serviceFees: {
        include: {
          settings: true,
          site: { select: { id: true, name: true } },
          account: { select: { userId: true, company: true } },
        },
      },
      user: { select: { email: true, name: true } },
    },
  })

  if (!partnerAccount) return null

  const accountFees = partnerAccount.serviceFees.filter(
    (f) => f.accountId === accountId,
  )

  return {
    partnerAccount,
    accountFees,
  }
}

// ─── Tax identity (track 026 phase 7a prerequisite) ─────────────────────────

/**
 * Set the partner's fiscal classification.
 *
 * This exists because `PartnerAccount.taxRegion` was added in phase 3 and
 * nothing could ever write it — so the instruction "set taxRegion in admin" was
 * impossible to carry out, and no Spanish partner was in scope of Veri*factu at
 * all. The register reported itself complete precisely because of that.
 *
 * **`taxRegion` must be a recognised province code.** `resolveTaxRegime` treats
 * an unrecognised value as `NONE` rather than as common territory, so a typo here
 * silently stops a partner's records being produced; and before that resolver was
 * tightened, a typo would have *filed a foral taxpayer's records to AEAT*.
 * Validated here as well as there — the setter explains the rejection, the
 * resolver fails safe.
 */
export async function setPartnerTaxIdentity(
  accountId: string,
  input: { taxRegion: string | null; isTestAccount: boolean },
): Promise<{ status: string; errors?: string[]; regime?: TaxRegime }> {
  await requireSudo()

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: accountId },
    select: { country: true, businessId: true },
  })
  if (!account) return { status: 'error', errors: ['Partner account not found'] }

  const region = (input.taxRegion ?? '').trim().toUpperCase()
  if (region !== '' && !isKnownEsRegion(region)) {
    return {
      status: 'error',
      errors: [
        `"${input.taxRegion}" is not a Spanish province code. Pick one from the list — an ` +
          'unrecognised value leaves the partner out of scope rather than filed.',
      ],
    }
  }

  await prisma.partnerAccount.update({
    where: { userId: accountId },
    data: {
      taxRegion: region === '' ? null : region,
      isTestAccount: input.isTestAccount,
    },
  })

  revalidatePath(`/partners/${accountId}`)
  return {
    status: 'ok',
    // The consequence, returned so the UI can state it rather than imply it.
    regime: resolveTaxRegime({ country: account.country, taxRegion: region }),
  }
}

// ─── Launch offer (track 027 D9) ────────────────────────────────────────────

/**
 * Grant the launch offer by hand — e.g. goodwill for a partner who signed up before the offer,
 * or re-activating a revoked one. The 30-day clock still starts at their first live paid booking.
 */
export async function grantPartnerPromotion(accountId: string): Promise<{ status: 'ok' | 'error'; errors?: string[] }> {
  const session = await requireSudo()
  const exists = await prisma.partnerAccount.findUnique({ where: { userId: accountId }, select: { userId: true } })
  if (!exists) return { status: 'error', errors: ['Partner not found'] }
  await grantLaunchPromotion(accountId, session.user!.id!)
  revalidatePath(`/partners/${accountId}`)
  return { status: 'ok' }
}

/** Revoke the launch offer: bookings created from now on are charged normally. */
export async function revokePartnerPromotion(accountId: string): Promise<{ status: 'ok' | 'error'; errors?: string[] }> {
  await requireSudo()
  await revokeLaunchPromotion(accountId)
  revalidatePath(`/partners/${accountId}`)
  return { status: 'ok' }
}
