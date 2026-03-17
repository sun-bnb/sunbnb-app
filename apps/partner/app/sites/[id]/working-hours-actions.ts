'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

// ─── Add Working Hours ──────────────────────────────────────────────────────

export async function addWorkingHours(
  siteId: string,
  workingHours: { day: string; openTime: string; closeTime: string }
) {
  // Input validation
  const dayNum = Number(workingHours.day)
  if (isNaN(dayNum) || !Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6) {
    return { status: 'error', errors: ['Day must be 0–6 (Sunday–Saturday)'] }
  }
  const timeRegex = /^\d{2}:\d{2}$/
  if (!timeRegex.test(workingHours.openTime) || !timeRegex.test(workingHours.closeTime)) {
    return { status: 'error', errors: ['Time must be in HH:MM format'] }
  }

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const openTimeDate = new Date('2000-01-01T' + workingHours.openTime + ':00.000')
  const closeTimeDate = new Date('2000-01-01T' + workingHours.closeTime + ':00.000')

  await prisma.siteWorkingHours.create({
    data: {
      day: Number(workingHours.day),
      openTime: openTimeDate,
      closeTime: closeTimeDate,
      site: { connect: { id: siteId } },
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Delete Working Hours ───────────────────────────────────────────────────

export async function deleteWorkingHours(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const wh = await prisma.siteWorkingHours.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!wh || wh.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.siteWorkingHours.delete({ where: { id } })
  revalidatePath('/sites')
  return { status: 'ok' }
}
