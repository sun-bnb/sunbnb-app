'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { isKnownBrandKey } from '@repo/data/brand-manifest'
import { revalidatePath } from 'next/cache'

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
}

// ─── Update Payment Provider ───────────────────────────────────────────────

export async function updatePaymentProvider(
  siteId: string,
  paymentProvider: string,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!siteId?.trim()) {
    return { status: 'error', errors: ['Site ID is required'] }
  }

  if (!['stripe', 'mollie'].includes(paymentProvider)) {
    return { status: 'error', errors: ['Invalid payment provider'] }
  }

  // If switching to Mollie, verify the site owner has connected Mollie
  if (paymentProvider === 'mollie') {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: {
        user: {
          select: {
            partnerAccount: {
              select: { mollieAccessToken: true },
            },
          },
        },
      },
    })
    if (!site?.user?.partnerAccount?.mollieAccessToken) {
      return { status: 'error', errors: ['Partner has not connected Mollie'] }
    }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { paymentProvider },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Custom Brand Page (track 023) ─────────────────────────────────────────

/**
 * Switch a site's bespoke brand page on or off.
 *
 * This is the LIVE half of a two-gate design: a per-site React module in
 * `apps/user/brands` decides whether a bespoke page EXISTS, and this column
 * decides whether it is serving. Keeping them separate is what allows a merged
 * page to sit dark until the customer approves it, and a broken one to be pulled
 * without a revert and a deploy.
 *
 * Admin-only rather than partner-editable: a bespoke page is platform-delivered
 * work, and the partner has no way to author or withdraw one.
 *
 * Switching it on for a site with no module is harmless and allowed — the user
 * app falls back to the standard page. That ordering is deliberate: the switch
 * can be armed before the code ships.
 */
export async function setCustomBrand(
  siteId: string,
  enabled: boolean,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!siteId?.trim()) {
    return { status: 'error', errors: ['Site ID is required'] }
  }

  // Typed, not coerced. A string ('false'), a checkbox 'on', or an absent value
  // would each be truthy or falsy by accident and silently flip a customer's
  // storefront the wrong way.
  if (typeof enabled !== 'boolean') {
    return { status: 'error', errors: ['Enabled must be a boolean'] }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { customBrandEnabled: enabled },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

/**
 * Assign (or clear) WHICH bespoke module renders a site.
 *
 * The key is validated against the shared manifest rather than accepted as free
 * text. A typo would otherwise be indistinguishable from a deleted module: both
 * resolve to `unknown-key` and quietly serve the standard page, and the operator
 * who made the typo is the least likely person to notice. Clearing is explicit —
 * an empty string stores NULL rather than a key nothing answers to.
 *
 * Assigning a key does NOT make the page live; `setCustomBrand` does. Two gates,
 * so a module can be assigned and reviewed while the customer decides.
 */
export async function setCustomBrandKey(
  siteId: string,
  key: string | null,
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!siteId?.trim()) {
    return { status: 'error', errors: ['Site ID is required'] }
  }

  const trimmed = key?.trim() || null

  if (trimmed !== null && !isKnownBrandKey(trimmed)) {
    return { status: 'error', errors: ['Unknown brand key'] }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { customBrandKey: trimmed },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}
