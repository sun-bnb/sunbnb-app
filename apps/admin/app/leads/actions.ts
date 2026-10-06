'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { setLeadStatus } from '@repo/data/leads'
import { LEAD_STATUS } from '@repo/data/lead-model'

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
  return session
}

/** Statuses the team may set by hand (`mockup` is system-only). */
export const SETTABLE_LEAD_STATUSES: readonly string[] = [
  LEAD_STATUS.DEMO_REQUESTED,
  LEAD_STATUS.CONTACTED,
  LEAD_STATUS.CONVERTED,
  LEAD_STATUS.CLOSED,
]

export async function updateLeadStatus(
  id: string,
  status: string,
): Promise<{ status: 'ok' | 'error'; errors?: string[] }> {
  await requireSudo()
  if (!SETTABLE_LEAD_STATUSES.includes(status)) {
    return { status: 'error', errors: ['Invalid status'] }
  }
  const ok = await setLeadStatus(id, status)
  if (!ok) return { status: 'error', errors: ['Lead not found'] }
  revalidatePath('/leads')
  revalidatePath(`/leads/${id}`)
  return { status: 'ok' }
}
