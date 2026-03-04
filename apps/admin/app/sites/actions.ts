'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
}

export async function updateBillingModel(
  siteId: string,
  billingModel: 'INTERMEDIARY' | 'DEEMED_PROVIDER'
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!siteId) return { status: 'error', errors: ['Site ID is required'] }
  if (!['INTERMEDIARY', 'DEEMED_PROVIDER'].includes(billingModel)) {
    return { status: 'error', errors: ['Invalid billing model'] }
  }

  try {
    await prisma.site.update({
      where: { id: siteId },
      data: { billingModel },
    })
    revalidatePath('/sites')
    return { status: 'ok' }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}

export async function updatePlatformVatConfig(
  siteId: string,
  platformVatConfigId: string | null
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  if (!siteId) return { status: 'error', errors: ['Site ID is required'] }

  try {
    await prisma.site.update({
      where: { id: siteId },
      data: { platformVatConfigId },
    })
    revalidatePath('/sites')
    return { status: 'ok' }
  } catch (err) {
    return { status: 'error', errors: [(err as Error).message] }
  }
}
