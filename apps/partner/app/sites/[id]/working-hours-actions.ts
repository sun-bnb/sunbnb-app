'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

type WorkingHour = { id: string; day: number; openTime: Date; closeTime: Date }

async function loadSiteWorkingHours(siteId: string): Promise<WorkingHour[]> {
  return prisma.siteWorkingHours.findMany({
    where: { siteId },
    select: { id: true, day: true, openTime: true, closeTime: true },
    orderBy: { day: 'asc' },
  })
}

// ─── Add Working Hours ──────────────────────────────────────────────────────

export async function addWorkingHours(
  siteId: string,
  workingHours: { day: string; openTime: string; closeTime: string }
) {
  // Day keys 1..7 are used by the UI (Mon..Sun); accept the full range here.
  const dayNum = Number(workingHours.day)
  if (isNaN(dayNum) || !Number.isInteger(dayNum) || dayNum < 0 || dayNum > 7) {
    return { status: 'error' as const, errors: ['Day must be 0–7'] }
  }
  const timeRegex = /^\d{2}:\d{2}$/
  if (!timeRegex.test(workingHours.openTime) || !timeRegex.test(workingHours.closeTime)) {
    return { status: 'error' as const, errors: ['Time must be in HH:MM format'] }
  }

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error' as const, errors: [error] }

  const openTimeDate = new Date('2000-01-01T' + workingHours.openTime + ':00.000')
  const closeTimeDate = new Date('2000-01-01T' + workingHours.closeTime + ':00.000')

  await prisma.siteWorkingHours.create({
    data: {
      day: dayNum,
      openTime: openTimeDate,
      closeTime: closeTimeDate,
      site: { connect: { id: siteId } },
    },
  })

  revalidatePath(`/sites/${siteId}/general`)
  const updated = await loadSiteWorkingHours(siteId)
  return { status: 'ok' as const, workingHours: updated }
}

// ─── Delete Working Hours ───────────────────────────────────────────────────

export async function deleteWorkingHours(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error' as const, errors: ['Not authenticated'] }

  const wh = await prisma.siteWorkingHours.findUnique({
    where: { id },
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!wh || wh.site.userId !== session.user.id) {
    return { status: 'error' as const, errors: ['Not authorized'] }
  }

  await prisma.siteWorkingHours.delete({ where: { id } })
  revalidatePath(`/sites/${wh.siteId}/general`)
  const updated = await loadSiteWorkingHours(wh.siteId)
  return { status: 'ok' as const, workingHours: updated }
}
