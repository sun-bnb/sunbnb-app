'use server'

/**
 * saveUploadGeoref (track 030 S7) -- persist the alignment the user confirmed for an aerial photo.
 *
 * Gate: `resolveAerialUpload` (session -> account-scoped upload, sudo ok -> live + site-bound ->
 * requireSiteOwner on the upload's site -> upload account == site owner). Any failure there answers
 * `Not authenticated` / `Not authorized` with no hint whether the upload exists. Then kill switch,
 * then the georef shape + ranges (`validateGeoref`), which must also land near the site.
 *
 * Result: `{ status: 'ok' }` | `{ status: 'error', errors: [...] }`.
 */
import { setUploadGeoref } from '@repo/data/assistant'
import { resolveAerialUpload } from '@/lib/assistant/aerial/access'
import { validateGeoref } from '@/lib/assistant/aerial/georef-validate'
import { assistantAvailable } from '@/lib/assistant/config'

export type SaveGeorefResult = { status: 'ok' } | { status: 'error'; errors: string[] }

export async function saveUploadGeoref(uploadId: string, georef: unknown): Promise<SaveGeorefResult> {
  const access = await resolveAerialUpload(uploadId)
  if (!access.ok) return { status: 'error', errors: [access.code === 'unauthenticated' ? 'Not authenticated' : 'Not authorized'] }
  if (!assistantAvailable()) return { status: 'error', errors: ['unavailable'] }

  const centre = { lat: parseFloat(access.site.locationLat), lng: parseFloat(access.site.locationLng) }
  const checked = validateGeoref(georef, Number.isFinite(centre.lat) && Number.isFinite(centre.lng) ? centre : null)
  if (!checked.ok) return { status: 'error', errors: checked.errors }

  const saved = await setUploadGeoref(access.upload.id, access.upload.accountId, checked.georef as unknown as Parameters<typeof setUploadGeoref>[2])
  return saved ? { status: 'ok' } : { status: 'error', errors: ['Not authorized'] }
}
