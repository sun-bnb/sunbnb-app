'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'

// ─── Auth guard ─────────────────────────────────────────────────────────────

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

// ─── Business Entity ────────────────────────────────────────────────────────

export async function saveBusinessEntity(input: {
  companyName: string
  companyAddress: string
  businessId: string
  vatId: string
  contactEmail: string
  contactPhone: string
}): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.companyName?.trim()) errors.push('Company name is required')
  if (errors.length > 0) return { status: 'error', errors }

  // Upsert into the singleton Settings row
  const existing = await prisma.settings.findFirst()

  const data = {
    companyName: input.companyName.trim(),
    companyAddress: input.companyAddress.trim(),
    businessId: input.businessId.trim(),
    vatId: input.vatId.trim(),
    contactEmail: input.contactEmail.trim(),
    contactPhone: input.contactPhone.trim(),
  }

  if (existing) {
    await prisma.settings.update({ where: { id: existing.id }, data })
  } else {
    await prisma.settings.create({ data })
  }

  revalidatePath('/platform')
  return { status: 'ok' }
}
