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

// ─── Payment Processing Fee CRUD ────────────────────────────────────────────

export async function savePaymentProcessingFee(input: {
  id?: string
  name: string
  fixedAmount?: number | null
  percentage?: number | null
  currency: string
}): Promise<{ status: string; id?: string; errors?: string[] }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.name?.trim()) errors.push('Name is required')
  if (!input.currency?.trim()) errors.push('Currency is required')
  if (input.fixedAmount == null && input.percentage == null) {
    errors.push('At least one of fixed amount or percentage is required')
  }
  if (errors.length > 0) return { status: 'error', errors }

  const data = {
    name: input.name.trim(),
    fixedAmount: input.fixedAmount ?? null,
    percentage: input.percentage ?? null,
    currency: input.currency.trim().toUpperCase(),
  }

  if (input.id) {
    await prisma.paymentProcessingFee.update({ where: { id: input.id }, data })
    revalidatePath('/platform')
    return { status: 'ok', id: input.id }
  } else {
    const created = await prisma.paymentProcessingFee.create({ data })
    revalidatePath('/platform')
    return { status: 'ok', id: created.id }
  }
}

export async function deletePaymentProcessingFee(
  id: string
): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()
  await prisma.paymentProcessingFee.delete({ where: { id } })
  revalidatePath('/platform')
  return { status: 'ok' }
}
