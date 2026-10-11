/**
 * Camera metadata of an aerial photo (track 030 S7) for the alignment SEED: DJI XMP pose
 * (`drone-dji:*`) and the EXIF 35 mm-equivalent focal length (horizontal FOV). Server-only.
 *
 * sharp already hands us the raw XMP packet and the raw EXIF block, so the one EXIF tag we need
 * (FocalLengthIn35mmFilm, 0xA405 in the Exif sub-IFD) is read by a ~40-line TIFF walk below instead
 * of pulling in an EXIF library.
 */
import { parseDjiXmp, type DjiXmp } from '@repo/agent/geo/georef'

export interface PhotoMeta {
  dji: DjiXmp | null
  /** EXIF FocalLengthIn35mmFilm (mm), when present and sane. */
  focal35mm: number | null
}

const EXIF_IFD_POINTER = 0x8769
const FOCAL_35MM = 0xa405

/** Read FocalLengthIn35mmFilm out of a raw EXIF block (with or without the `Exif\0\0` prefix). */
export function readFocal35mm(exif: Uint8Array | null | undefined): number | null {
  if (!exif || exif.length < 14) return null
  const buf = Buffer.from(exif.buffer, exif.byteOffset, exif.byteLength)
  const base = buf.toString('latin1', 0, 4) === 'Exif' ? 6 : 0
  if (buf.length < base + 8) return null
  const order = buf.toString('latin1', base, base + 2)
  if (order !== 'II' && order !== 'MM') return null
  const le = order === 'II'
  const u16 = (o: number) => (o + 2 <= buf.length ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : -1)
  const u32 = (o: number) => (o + 4 <= buf.length ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : -1)
  if (u16(base + 2) !== 42) return null

  /** Find `tag` in the IFD at TIFF offset `ifd`; returns the entry's offset (absolute) or -1. */
  const findTag = (ifd: number, tag: number): number => {
    const at = base + ifd
    const n = u16(at)
    if (n < 0 || n > 1000) return -1
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12
      if (e + 12 > buf.length) return -1
      if (u16(e) === tag) return e
    }
    return -1
  }
  const ifd0 = u32(base + 4)
  if (ifd0 < 0) return null
  const ptr = findTag(ifd0, EXIF_IFD_POINTER)
  if (ptr < 0) return null
  const exifIfd = u32(ptr + 8)
  if (exifIfd <= 0) return null
  const e = findTag(exifIfd, FOCAL_35MM)
  if (e < 0) return null
  // SHORT (type 3), count 1: the value sits in the first 2 bytes of the value field.
  const type = u16(e + 2)
  const v = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : -1
  return v > 0 && v < 2000 ? v : null
}

/** DJI pose + focal length from the ORIGINAL upload bytes (the resized copy has no metadata). */
export async function readPhotoMeta(original: Buffer): Promise<PhotoMeta> {
  try {
    const sharp = (await import('sharp')).default
    const m = await sharp(original).metadata()
    const xmp = m.xmp ? Buffer.from(m.xmp).toString('utf8') : ''
    return { dji: xmp ? parseDjiXmp(xmp) : null, focal35mm: readFocal35mm(m.exif) }
  } catch {
    return { dji: null, focal35mm: null }
  }
}
