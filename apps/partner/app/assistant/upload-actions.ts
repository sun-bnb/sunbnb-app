'use server'

/**
 * uploadAssistantFile (track 030 S5) -- company documents / photos for the assistant.
 *
 * Gate order, cheapest first: requireSiteOwner (sudo ok) -> kill switch -> flag `assistant` -> size /
 * magic-byte validation -> per-account daily cap -> Blob -> AssistantUpload row. The row belongs to the
 * SITE OWNER's account (a sudo uploading while impersonating-by-support still files it under the owner).
 *
 * Result: `{ status: 'ok', upload: { id, name, mime, sizeBytes, kind } }` or
 * `{ status: 'error', errors: [code] }`, code in too_large | unsupported_type | forbidden | rate_limited | unavailable.
 */
import { createUpload } from '@repo/data/assistant'
import { getFlagStates } from '@repo/data/flags'
import prisma from '@repo/data/PrismaCient'
import { rateLimitShared } from '@repo/data/rate-limit-shared'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { assistantAvailable } from '@/lib/assistant/config'
import { ID } from '@/lib/assistant/request'
import { MAX_UPLOAD_BYTES, safeDisplayName, storeUploadBlob, UPLOADS_PER_DAY, uploadBlobKey, validateUpload, type UploadErrorCode, type UploadKind } from '@/lib/assistant/uploads'

export type UploadResult =
  | { status: 'ok'; upload: { id: string; name: string; mime: string; sizeBytes: number; kind: UploadKind } }
  | { status: 'error'; errors: [UploadErrorCode] | [UploadErrorCode, string] }

const fail = (code: UploadErrorCode): UploadResult => ({ status: 'error', errors: [code] })

export async function uploadAssistantFile(siteId: string, formData: FormData): Promise<UploadResult> {
  if (typeof siteId !== 'string' || !ID.test(siteId)) return fail('forbidden')
  const { session, error } = await requireSiteOwner(siteId)
  // errors[0] is the code; errors[1] the ownership gate's own message (Not authenticated / Not authorized).
  if (error) return { status: 'error', errors: ['forbidden', error] }

  if (!assistantAvailable()) return fail('unavailable')
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { sudo: true } })
  const flags = await getFlagStates({ isSudo: !!user?.sudo, accountId: session.user.id })
  if (!flags.assistant?.enabled) return fail('forbidden')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return fail('forbidden')

  const file = formData?.get('file')
  if (!(file instanceof File)) return fail('unsupported_type')
  // Size from the declared length first: an oversize file is never read into memory.
  if (file.size > MAX_UPLOAD_BYTES) return fail('too_large')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = validateUpload({ size: file.size, bytes }, formData.get('kind'))
  if (!checked.ok) return fail(checked.code)

  const limit = await rateLimitShared(`assistant:upload:${site.userId}`, { maxAttempts: UPLOADS_PER_DAY, windowMs: 24 * 60 * 60 * 1000 })
  if (!limit.allowed) return fail('rate_limited')

  try {
    if (checked.mime.startsWith('image/')) {
      // Must be decodable NOW, not when the model turn runs (HEIC needs libheif support in sharp).
      const sharp = (await import('sharp')).default
      const probe = sharp(Buffer.from(bytes))
      if (checked.mime === 'image/heic' || checked.mime === 'image/heif') await probe.resize(8).jpeg().toBuffer()
      else await probe.metadata()
    }
  } catch {
    return fail('unsupported_type')
  }

  const name = safeDisplayName(file.name)
  try {
    const key = uploadBlobKey(site.userId, name)
    const blob = await storeUploadBlob(key, Buffer.from(bytes), checked.mime)
    const row = await createUpload({
      accountId: site.userId,
      siteId,
      blobKey: key,
      url: blob.url,
      mime: checked.mime,
      sizeBytes: checked.sizeBytes,
      purpose: checked.kind,
    })
    return { status: 'ok', upload: { id: row.id, name, mime: checked.mime, sizeBytes: checked.sizeBytes, kind: checked.kind } }
  } catch (err) {
    console.error('[partner] assistant upload failed', err)
    return fail('unavailable')
  }
}
