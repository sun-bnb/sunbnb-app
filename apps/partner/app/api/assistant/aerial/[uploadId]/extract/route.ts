/**
 * POST /api/assistant/aerial/[uploadId]/extract -- read an aerial photo into a vision descriptor
 * (track 030 S7). Idempotent: the first call runs the (up to minutes-long) extraction and answers
 * when it is done; every other call answers the stored state at once -- `{ status: 'running' |
 * 'done' | 'failed', error?, usable?, view?, parcels? }`. The client polls while `running`.
 *
 * Gates, cheapest first, nothing spent before all pass: kill switch (503) -> session (401) ->
 * upload resolved account-scoped + site owner (404 for missing / foreign / other-site / expired,
 * sudo ok) -> flag `assistant` (403) -> image mime (415) -> site in MAP mode (409; schematic sites
 * read plans instead) -> global AI budget not switched off (503). Billing happens only inside
 * `runAerialExtraction`, after its CAS claim (one model call per upload; limits hit only then).
 */
import { getFlagStates } from '@repo/data/flags'
import prisma from '@repo/data/PrismaCient'
import { resolveAerialUpload } from '@/lib/assistant/aerial/access'
import { runAerialExtraction } from '@/lib/assistant/aerial/extract'
import { isAerialImageMime } from '@/lib/assistant/aerial/image'
import { assistantAvailable } from '@/lib/assistant/config'
import { assistantDailyBudget } from '@/lib/assistant/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const err = (status: number, code: string) => Response.json({ status: 'error', code }, { status })

export async function POST(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  if (!assistantAvailable()) return err(503, 'unavailable')
  const { uploadId } = await params

  const access = await resolveAerialUpload(uploadId)
  if (!access.ok) return access.code === 'unauthenticated' ? err(401, 'unauthorized') : err(404, 'not_found')
  const { upload, site, sessionUserId } = access

  const user = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { sudo: true } })
  const flags = await getFlagStates({ isSudo: !!user?.sudo, accountId: sessionUserId })
  if (!flags.assistant?.enabled) return err(403, 'forbidden')

  if (!isAerialImageMime(upload.mime)) return err(415, 'unsupported_type')
  if (site.layoutMode === 'schematic') return err(409, 'schematic_site')
  if (assistantDailyBudget() === 0) return err(503, 'budget')

  const result = await runAerialExtraction({ uploadId: upload.id, accountId: upload.accountId, userId: sessionUserId, url: upload.url, signal: request.signal })
  if (result.status === 'failed' && (result.error === 'rate_limited' || result.error === 'aerial_limit' || result.error === 'extraction_limit')) {
    return Response.json(result, { status: 429 })
  }
  return Response.json(result)
}
