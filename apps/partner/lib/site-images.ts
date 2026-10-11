/**
 * Core image writers (track 030 S6a): store an ALREADY-STORED image URL on the one row that shows
 * it. The upload actions (`uploadContentImage`, `updateProductImage`) and the assistant's
 * `place_image` proposal share these, so "where does a cover / product / rental / brand / underlay
 * image live" is answered once.
 *
 * NO session check here: callers own authorisation (the upload actions run `requireSiteOwner` /
 * `isOwnerOrSudo`; the proposal lifecycle re-runs `requireSiteOwner(siteId)`). What every writer DOES
 * enforce is scope: the row must belong to `siteId`, so an id from another site can never be written.
 *
 * `dims` semantics: `undefined` / missing key = leave the stored dimensions alone; an explicit
 * `null` = clear them (used by undo to restore "no image").
 */
import prisma from '@repo/data/PrismaCient'

export interface ImageDims {
  width?: number | null
  height?: number | null
}

export type ImageWrite = { ok: true } | { ok: false; error: string }

const OK: ImageWrite = { ok: true }

/** `{ [wKey]: w, [hKey]: h }` for the dimensions that were given. */
function dimData(wKey: string, hKey: string, dims?: ImageDims): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  if (dims?.width !== undefined) out[wKey] = dims.width
  if (dims?.height !== undefined) out[hKey] = dims.height
  return out
}

/** Site cover photo (Content tab): `Site.image` + `imageWidth/imageHeight`. */
export async function setSiteCover(siteId: string, url: string | null, dims?: ImageDims): Promise<ImageWrite> {
  await prisma.site.update({
    where: { id: siteId },
    data: { image: url, ...dimData('imageWidth', 'imageHeight', dims) },
  })
  return OK
}

/** Product image: `Product.imageUrl` + dimensions. The product must belong to `siteId`. */
export async function setProductImage(siteId: string, productId: string, url: string | null, dims?: ImageDims): Promise<ImageWrite> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { siteId: true } })
  if (!product || product.siteId !== siteId) return { ok: false, error: 'Product not found' }
  await prisma.product.update({
    where: { id: productId },
    data: { imageUrl: url, ...dimData('imageWidth', 'imageHeight', dims) },
  })
  return OK
}

/** Rental item image: `RentalItem.imageUrl` (the model has no dimension columns). */
export async function setRentalItemImage(siteId: string, itemId: string, url: string | null): Promise<ImageWrite> {
  const item = await prisma.rentalItem.findUnique({ where: { id: itemId }, select: { siteId: true } })
  if (!item || item.siteId !== siteId) return { ok: false, error: 'Rental item not found' }
  await prisma.rentalItem.update({ where: { id: itemId }, data: { imageUrl: url } })
  return OK
}

/** Brand logo / background image. A brand row must already exist (its name is required). */
export async function setBrandImage(siteId: string, which: 'logo' | 'background', url: string | null, dims?: ImageDims): Promise<ImageWrite> {
  const brand = await prisma.siteBrand.findUnique({ where: { siteId }, select: { id: true } })
  if (!brand) return { ok: false, error: 'This site has no brand yet: set a brand name first' }
  await prisma.siteBrand.update({
    where: { siteId },
    data:
      which === 'logo'
        ? { logoUrl: url }
        : { bgImageUrl: url, ...dimData('bgImageWidth', 'bgImageHeight', dims) },
  })
  return OK
}

/** Schematic canvas underlay: `Site.bgImageUrl` (+ dimensions). Stretched over the whole canvas. */
export async function setSchematicUnderlay(siteId: string, url: string | null, dims?: ImageDims): Promise<ImageWrite> {
  await prisma.site.update({
    where: { id: siteId },
    data: { bgImageUrl: url, ...dimData('bgImageWidth', 'bgImageHeight', dims) },
  })
  return OK
}
