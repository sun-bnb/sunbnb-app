/**
 * Venue POS map — data loader.
 *
 * Shared by the two ways into the same page: the legacy `/sites/{id|slug}/pos`
 * and the short `/q/{siteCode}` a printed venue card carries (track 022). One
 * loader so the map they render cannot drift apart; only the `where` differs.
 */

import prisma from '@repo/data/PrismaCient'

type SiteWhere = NonNullable<Parameters<typeof prisma.site.findFirst>[0]>['where']

export async function getPosSite(where: SiteWhere) {
  return await prisma.site.findFirst({
    where,
    include: {
      inventoryItems: {
        include: {
          reservations: {
            orderBy: { from: 'desc' }
          },
          sunbedGroup: {
            include: { items: { select: { id: true } } }
          }
        }
      }
    }
  })
}
