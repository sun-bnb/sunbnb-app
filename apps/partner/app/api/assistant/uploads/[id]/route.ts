/**
 * GET /api/assistant/uploads/[id] -- streams one assistant upload back to its owner (track 030 S6b),
 * so the proposal card and the transcript can show thumbnails even when the blob is PRIVATE.
 *
 * Gate: session (401) -> account-scoped lookup (`getUploadForAccount`; a platform sudo may read any
 * account's upload, like every other owner check here). Missing, foreign, expired and purged all
 * answer the same 404 so nothing about other accounts leaks. The browser may cache it, but never a
 * shared cache (`private`).
 */
import { getUploadForAccount } from '@repo/data/assistant'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { readUploadBlob } from '@/lib/assistant/uploads'

export const dynamic = 'force-dynamic'

const notFound = () => Response.json({ status: 'error', code: 'not_found' }, { status: 404 })

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ status: 'error', code: 'unauthorized' }, { status: 401 })
  const { id } = await params

  let row = await getUploadForAccount(id, session.user.id)
  if (!row) {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { sudo: true } })
    if (user?.sudo) row = await prisma.assistantUpload.findFirst({ where: { id, deletedAt: null } })
  }
  if (!row || row.expiresAt.getTime() <= Date.now()) return notFound()

  let bytes: Buffer
  try {
    bytes = await readUploadBlob(row.url)
  } catch {
    return notFound()
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
