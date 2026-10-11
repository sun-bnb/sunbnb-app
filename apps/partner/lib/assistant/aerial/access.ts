/**
 * Who may touch an aerial upload (track 030 S7) -- shared by the extract route, the overlay image
 * route and `saveUploadGeoref`.
 *
 * session -> account-scoped upload (`getUploadForAccount`; a platform sudo may reach any account's,
 * like every owner check here) -> live (not expired / purged) and bound to a site -> requireSiteOwner
 * on THAT site (sudo ok) -> the upload's account is the site's owner. Missing, foreign, expired,
 * site-less and other-site uploads are indistinguishable (`not_found`).
 */
import { getUploadForAccount } from '@repo/data/assistant'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { ID } from '../request'

export interface AerialSite {
  id: string
  userId: string
  layoutMode: string | null
  locationLat: string
  locationLng: string
}

export type AerialUploadRow = NonNullable<Awaited<ReturnType<typeof getUploadForAccount>>>

export type AerialAccess =
  | { ok: true; sessionUserId: string; upload: AerialUploadRow; site: AerialSite }
  | { ok: false; code: 'unauthenticated' | 'not_found' }

export async function resolveAerialUpload(uploadId: unknown, now: Date = new Date()): Promise<AerialAccess> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, code: 'unauthenticated' }
  if (typeof uploadId !== 'string' || !ID.test(uploadId)) return { ok: false, code: 'not_found' }

  let row = await getUploadForAccount(uploadId, userId)
  if (!row) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { sudo: true } })
    if (user?.sudo) row = await prisma.assistantUpload.findFirst({ where: { id: uploadId, deletedAt: null } })
  }
  if (!row || !row.siteId || row.expiresAt.getTime() <= now.getTime()) return { ok: false, code: 'not_found' }

  const { error } = await requireSiteOwner(row.siteId)
  if (error) return { ok: false, code: 'not_found' }
  const site = await prisma.site.findUnique({
    where: { id: row.siteId },
    select: { id: true, userId: true, layoutMode: true, locationLat: true, locationLng: true },
  })
  if (!site || site.userId !== row.accountId) return { ok: false, code: 'not_found' }
  return { ok: true, sessionUserId: userId, upload: row, site }
}
