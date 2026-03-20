'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

/**
 * Verify the current user is authenticated and owns the given site.
 * Returns the session on success, or an error message.
 */
export async function requireSiteOwner(
  siteId: string
): Promise<{ session: any; error: string | null }> {
  const session = await auth()
  if (!session?.user) return { session: null, error: 'Not authenticated' }

  // Sudo users bypass ownership check
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (user?.sudo) return { session, error: null }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { session, error: 'Not authorized' }
  }

  return { session, error: null }
}
