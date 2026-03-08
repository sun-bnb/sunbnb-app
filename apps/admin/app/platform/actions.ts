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

// ─── Settings (country/currency/vat) ────────────────────────────────────────

export type SettingsRow = {
  id: string
  country: string | null
  vat: number | null
  currency: string | null
}

export async function getSettings(): Promise<SettingsRow[]> {
  await requireSudo()
  return prisma.settings.findMany({
    select: { id: true, country: true, vat: true, currency: true },
    orderBy: { country: 'asc' },
  })
}

export async function saveSettings(input: {
  id?: string
  country: string
  currency: string
  vat: string
}): Promise<{ status: string; errors?: string[]; settings?: SettingsRow }> {
  await requireSudo()

  const errors: string[] = []
  if (!input.country?.trim()) errors.push('Country is required')
  if (!input.currency?.trim()) errors.push('Currency is required')
  const vatNum = input.vat === '' ? null : parseFloat(input.vat)
  if (input.vat !== '' && (vatNum === null || isNaN(vatNum!))) errors.push('Tax rate must be a number')
  if (vatNum !== null && !isNaN(vatNum!) && (vatNum! < 0 || vatNum! > 100)) errors.push('Tax rate must be 0–100')
  if (errors.length > 0) return { status: 'error', errors }

  const data = {
    country: input.country.trim().toUpperCase(),
    currency: input.currency.trim().toUpperCase(),
    vat: vatNum,
  }

  let settings: SettingsRow
  if (input.id) {
    settings = await prisma.settings.update({
      where: { id: input.id },
      data,
      select: { id: true, country: true, vat: true, currency: true },
    })
  } else {
    settings = await prisma.settings.create({
      data,
      select: { id: true, country: true, vat: true, currency: true },
    })
  }

  revalidatePath('/platform')
  revalidatePath('/fees')
  return { status: 'ok', settings }
}

export async function deleteSettings(id: string): Promise<{ status: string; errors?: string[] }> {
  await requireSudo()

  // Prevent delete if settings has associated service fees
  const feeCount = await prisma.serviceFee.count({ where: { settingsId: id } })
  if (feeCount > 0) {
    return { status: 'error', errors: [`Cannot delete: ${feeCount} service fee(s) reference this settings entry. Remove them first.`] }
  }

  await prisma.settings.delete({ where: { id } })

  revalidatePath('/platform')
  revalidatePath('/fees')
  return { status: 'ok' }
}
