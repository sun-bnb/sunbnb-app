/**
 * GET /api/cron/purge-assistant-uploads -- daily (vercel.json). Assistant uploads (company documents,
 * photos) are kept 30 days at most (track 030 D8): this deletes the Blob of every expired
 * `AssistantUpload` and stamps `deletedAt`. Idempotent and retry-safe: a blob that fails to delete is
 * left unstamped and picked up on the next run. Fails closed without CRON_SECRET, like every cron here.
 *
 * Not done: the "24 h after the proposal resolves" early purge -- an upload has no link to the
 * proposals it produced (they hang off the conversation), so only the 30-day TTL applies.
 */
import { listExpiredUploads, markUploadDeleted } from '@repo/data/assistant'
import { deleteUploadBlob } from '@/lib/assistant/uploads'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rows = await listExpiredUploads(new Date())
  let purged = 0
  let failed = 0
  for (const row of rows) {
    try {
      await deleteUploadBlob(row.url)
      await markUploadDeleted(row.id)
      purged++
    } catch (err) {
      failed++
      console.error('[purge-assistant-uploads] delete failed', row.id, err)
    }
  }
  return Response.json({ checked: rows.length, purged, failed })
}
