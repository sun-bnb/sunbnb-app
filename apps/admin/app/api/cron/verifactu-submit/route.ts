/**
 * Cron: submit pending Veri*factu records to AEAT (track 026 phase 7.1b).
 *
 * Lives in the ADMIN app rather than the user app. The `prune-telemetry`
 * precedent argues for putting a sweep where its data is written, which would be
 * `packages/data` either way; what decides it here is that this route is the only
 * thing in the system holding a certificate that can act for a taxpayer at AEAT,
 * and admin has by far the smallest public attack surface of the three apps. The
 * ops surface (P9) belongs here too, so the dashboard and the sweep stay together.
 *
 * ## Scope: our OWN invoices only, for now
 *
 * `submitPlatformRecords` restricts the sweep to records whose issuer is Sunbnb
 * España SL. AEAT error `4112` accepts the certificate holder as *Obligado
 * Emisión*, and we are exactly that on our own commission invoices — so this
 * works on the certificate alone, with no colaboración social agreement and no
 * partner having signed anything. A partner's records stay queued, which is the
 * correct state rather than a failure, until P7a captures their grant.
 *
 * ## What a non-200 means
 *
 * Nothing that endangers an invoice. Records queue, with periodic retries, which
 * is what AEAT itself prescribes for an incident (developer FAQ §2). The cron
 * failing is an ops event, never a reason a sale could not be invoiced.
 *
 * Protected by CRON_SECRET, like every other cron in this repo.
 *
 * GET /api/cron/verifactu-submit
 */

import { NextResponse } from 'next/server'
import { submitPlatformRecords } from '@repo/data/tax/es-verifactu/submit'
import { AeatCertificateMissingError } from '@repo/data/tax/es-verifactu/client'

export const dynamic = 'force-dynamic'
/** The sweep makes one network round trip per issuer; give it room. */
export const maxDuration = 60

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await submitPlatformRecords()
    return NextResponse.json(result)
  } catch (error) {
    // A missing certificate in explicit `http` mode is a configuration error, not
    // a transient one, and it must be loud: the alternative — falling back to a
    // stub — would mark records sent while AEAT held nothing.
    if (error instanceof AeatCertificateMissingError) {
      console.error('[Verifactu] submission sweep cannot run:', error.message)
      return NextResponse.json({ error: 'AEAT certificate not configured' }, { status: 503 })
    }
    console.error('[Verifactu] submission sweep failed:', error)
    return NextResponse.json({ error: 'Submission sweep failed' }, { status: 500 })
  }
}
