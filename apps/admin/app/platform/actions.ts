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

// ─── Save or create a PlatformVatConfig ─────────────────────────────────────

export async function savePlatformVatConfig(input: {
  id?: string
  countryCode: string
  vatNumber: string
  companyName: string
  companyAddress: string
  ossRegistered: boolean
}): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.countryCode?.trim()) errors.push('Country code is required')
  if (!input.vatNumber?.trim()) errors.push('VAT number is required')
  if (!input.companyName?.trim()) errors.push('Company name is required')
  if (!input.companyAddress?.trim()) errors.push('Company address is required')
  if (errors.length > 0) return { status: 'error', errors }

  const data = {
    countryCode: input.countryCode.trim().toUpperCase(),
    vatNumber: input.vatNumber.trim(),
    companyName: input.companyName.trim(),
    companyAddress: input.companyAddress.trim(),
    ossRegistered: input.ossRegistered,
  }

  if (input.id) {
    await prisma.platformVatConfig.update({
      where: { id: input.id },
      data,
    })
  } else {
    // Check for duplicate country code
    const existing = await prisma.platformVatConfig.findUnique({
      where: { countryCode: data.countryCode },
    })
    if (existing) {
      return { status: 'error', errors: [`Config for ${data.countryCode} already exists`] }
    }
    await prisma.platformVatConfig.create({ data })
  }

  revalidatePath('/platform')
  return { status: 'ok' }
}

// ─── Delete a PlatformVatConfig ─────────────────────────────────────────────

export async function deletePlatformVatConfig(
  id: string
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  await prisma.platformVatConfig.delete({ where: { id } })

  revalidatePath('/platform')
  return { status: 'ok' }
}
