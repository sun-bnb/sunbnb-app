import { redirect } from 'next/navigation'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { resolveTaxRegime } from '@repo/data/tax/regime'
import { grantState } from '@repo/data/tax/es-verifactu/grants'
import VerifactuAuthorisationView from './view'

/**
 * Where a Spanish partner authorises us to invoice and file for them (P7a).
 *
 * Two legal acts, accepted together:
 *   - art. 5 RD 1619/2012 — we expedite invoices in their name
 *   - colaboración social — we submit their records to AEAT
 *
 * Shown to Spanish partners only. For everyone else Veri*factu does not apply,
 * and asking them to authorise something that will never happen is noise.
 */
export default async function VerifactuAuthorisationPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      company: true,
      country: true,
      taxRegion: true,
      businessId: true,
      invoicingAuthorityGrantedAt: true,
      aeatSubmissionGrantedAt: true,
      verifactuGrantTermsVersion: true,
    },
  })
  if (!account) redirect('/account')

  const regime = resolveTaxRegime({
    country: account.country,
    taxRegion: account.taxRegion,
  })
  const state = grantState(account)

  return (
    <VerifactuAuthorisationView
      company={account.company}
      businessId={account.businessId}
      isSpanish={(account.country ?? '').toUpperCase() === 'ES'}
      regime={regime}
      state={state}
      invoicingGrantedAt={account.invoicingAuthorityGrantedAt?.toISOString() ?? null}
      submissionGrantedAt={account.aeatSubmissionGrantedAt?.toISOString() ?? null}
      termsVersion={account.verifactuGrantTermsVersion}
    />
  )
}
