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
 * ## Scope: every authorised issuer (P7.2)
 *
 * `submitPendingRecords` covers our own commission invoices AND every partner
 * who has granted us representation. It is safe to widen it before the Convenio
 * 017 agreement is approved, which is the whole point of P7.2: the sweep checks
 * our own grant record before sending, and if AEAT refuses us anyway with
 * `4112` the records are parked and retried rather than blocked. So this route
 * needs no change when the Convenio lands — the first sweep afterwards simply
 * succeeds.
 *
 * It was deliberately `submitPlatformRecords` until P7.2, when all it could
 * safely cover was the case needing no external approval at all.
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
import { submitPendingRecords } from '@repo/data/tax/es-verifactu/submit'
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
    const result = await submitPendingRecords()
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
