/**
 * The ONE pixel frame of an aerial photo (track 030 S7). The vision descriptor, the overlay image the
 * alignment UI shows and the saved georef all live in the frame this produces: EXIF orientation baked
 * in, long edge <= 2000 px, JPEG. Every consumer must go through `prepareAerialImage` so their pixel
 * coordinates agree (sharp's resize is deterministic for the same input).
 */
export const AERIAL_MAX_EDGE_PX = 2000

export const AERIAL_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const isAerialImageMime = (mime: string): boolean => (AERIAL_IMAGE_MIMES as readonly string[]).includes(mime)

export interface AerialImage {
  data: Buffer
  width: number
  height: number
  mediaType: 'image/jpeg'
}

export async function prepareAerialImage(input: Buffer): Promise<AerialImage> {
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: AERIAL_MAX_EDGE_PX, height: AERIAL_MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, mediaType: 'image/jpeg' }
}
