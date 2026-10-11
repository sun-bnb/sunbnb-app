/**
 * GET /api/assistant/uploads/[id]/image -- the aerial photo in the alignment frame (track 030 S7):
 * EXIF-oriented, long edge <= 2000 px, JPEG (`prepareAerialImage`, the SAME frame the vision
 * descriptor and the saved georef use). `X-Image-Size: WxH` tells the overlay its pixel size.
 *
 * Gate: session (401) -> `resolveAerialUpload` (account-scoped, live, site-bound, site owner; sudo
 * ok) -> image mime. Every "not yours / gone / not an image" is the same 404. Privately cacheable.
 */
import { resolveAerialUpload } from '@/lib/assistant/aerial/access'
import { isAerialImageMime, prepareAerialImage } from '@/lib/assistant/aerial/image'
import { readUploadBlob } from '@/lib/assistant/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => Response.json({ status: 'error', code: 'not_found' }, { status: 404 })

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await resolveAerialUpload(id)
  if (!access.ok) return access.code === 'unauthenticated' ? Response.json({ status: 'error', code: 'unauthorized' }, { status: 401 }) : notFound()
  if (!isAerialImageMime(access.upload.mime)) return notFound()

  let image
  try {
    image = await prepareAerialImage(await readUploadBlob(access.upload.url))
  } catch {
    return notFound()
  }
  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mediaType,
      'Content-Length': String(image.data.length),
      'X-Image-Size': `${image.width}x${image.height}`,
      'Access-Control-Expose-Headers': 'X-Image-Size',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
