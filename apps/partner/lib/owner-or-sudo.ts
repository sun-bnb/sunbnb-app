import prisma from '@repo/data/PrismaCient'

/**
 * True when `userId` owns the resource (`ownerId`) or is a platform sudo.
 *
 * For actions that look the owner up THROUGH a child row (product / working-hours slot) and so
 * cannot call `requireSiteOwner(siteId)` before the row is fetched. Reads the sudo flag only when
 * the ids differ, so the owner's own request costs no extra query. Sudo bypass matches
 * `requireSiteOwner` (`.claude/rules/auth.md`).
 */
export async function isOwnerOrSudo(ownerId: string | null | undefined, userId: string): Promise<boolean> {
  if (ownerId && ownerId === userId) return true
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sudo: true } })
  return !!user?.sudo
}
