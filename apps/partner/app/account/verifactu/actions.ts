'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  VERIFACTU_GRANT_TERMS_VERSION,
  type GrantEvidence,
} from '@repo/data/tax/es-verifactu/grants'

/**
 * Record a partner's Veri*factu authorisations (track 026 P7a).
 *
 * TWO distinct legal acts, accepted together but stored apart:
 *   - art. 5 RD 1619/2012 — we may EXPEDITE invoices in their name
 *   - colaboración social — we may SUBMIT their records to AEAT
 *
 * Evidence is captured because the grant is the only thing standing between us
 * and an unauthorised filing: AEAT is explicit that no colaborador social may
 * send without prior authorisation, so "we think they agreed" is not enough.
 *
 * Scoped to the caller's OWN account — `session.user.id` is the PartnerAccount's
 * `userId`, never taken from the form.
 */
export async function grantVerifactuAuthorisations(): Promise<{
  status: string
  errors?: string[]
}> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      userId: true,
      invoicingAuthorityGrantedAt: true,
      aeatSubmissionGrantedAt: true,
    },
  })
  if (!account) return { status: 'error', errors: ['No partner account'] }

  const now = new Date()
  const h = await headers()
  const evidence: GrantEvidence = {
    acceptedByUserId: session.user.id,
    acceptedByEmail: session.user.email ?? null,
    acceptedAt: now.toISOString(),
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
    termsVersion: VERIFACTU_GRANT_TERMS_VERSION,
  }

  await prisma.partnerAccount.update({
    where: { userId: session.user.id },
    data: {
      // Re-accepting is not an error, but it must not move an existing grant's
      // date — the original act is what was authorised, and when it happened is
      // what an inspector would ask about.
      //
      // The two are preserved INDEPENDENTLY. They are separate acts, and a
      // partner can reach this page having granted one and not the other.
      invoicingAuthorityGrantedAt: account.invoicingAuthorityGrantedAt ?? now,
      aeatSubmissionGrantedAt: account.aeatSubmissionGrantedAt ?? now,
      verifactuGrantTermsVersion: VERIFACTU_GRANT_TERMS_VERSION,
      verifactuGrantEvidence: { ...evidence },
    },
  })

  revalidatePath('/account/verifactu')
  return { status: 'ok' }
}
