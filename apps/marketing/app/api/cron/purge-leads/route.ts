/**
 * GET /api/cron/purge-leads — daily retention sweep (Vercel Cron, `vercel.json`). Deletes exactly
 * what the privacy notice promises: anonymous mockups after 90 idle days, contacts after 24
 * idle months (`purgeExpiredLeads`). Vercel Cron authenticates with `Authorization: Bearer
 * $CRON_SECRET`; without the secret configured the endpoint refuses rather than running open.
 */
import type { NextRequest } from 'next/server'
import { purgeExpiredLeads } from '@repo/data/leads'
import { pruneRateLimitCounters } from '@repo/data/rate-limit-shared'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'not_configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const deleted = await purgeExpiredLeads()
  const rateLimitCounters = await pruneRateLimitCounters()
  console.log('[marketing] lead retention sweep', deleted, { rateLimitCounters })
  return Response.json({ deleted, rateLimitCounters })
}
