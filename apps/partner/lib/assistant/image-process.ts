/**
 * Normalise a user's photo before it becomes a PUBLIC site image (track 030 S6a).
 *
 * Phone photos are 3-12 MB and carry EXIF (GPS position, device, time). Placing one on the booking
 * page as-is would publish all of that, so: auto-orient (EXIF rotation baked into the pixels), cap
 * the long edge, and re-encode in the SAME format, which drops the metadata. The existing manual
 * upload paths store the file untouched; this is stricter on purpose because the source here is an
 * unreviewed private attachment.
 */
export const PLACEABLE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type PlaceableMime = (typeof PLACEABLE_MIMES)[number]

export const MAX_EDGE_PX = 2400

export const isPlaceableMime = (mime: string): mime is PlaceableMime => (PLACEABLE_MIMES as readonly string[]).includes(mime)

export const EXT_BY_MIME: Record<PlaceableMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export interface ProcessedImage {
  data: Buffer
  contentType: PlaceableMime
  width: number
  height: number
}

export async function processPlacedImage(input: Buffer, mime: PlaceableMime): Promise<ProcessedImage> {
  const sharp = (await import('sharp')).default
  let pipeline = sharp(input).rotate().resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
  pipeline = mime === 'image/jpeg' ? pipeline.jpeg({ quality: 85, mozjpeg: true }) : mime === 'image/png' ? pipeline.png() : pipeline.webp({ quality: 85 })
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return { data, contentType: mime, width: info.width, height: info.height }
}
