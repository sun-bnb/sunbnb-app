'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

// ─── Save General Settings ──────────────────────────────────────────────────

export async function saveGeneral(input: {
  id: string
  name: string
  type: string
  price: string
  vat: string
  locationLat: string
  locationLng: string
}): Promise<{ status: string; errors?: string[] }> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const errors: string[] = []
  if (!input.name?.trim()) errors.push('Site name is required')
  if (!input.locationLat || !input.locationLng) errors.push('Location is required')
  if (errors.length > 0) return { status: 'error', errors }

  const price = Number(input.price)
  const vat = Number(input.vat)

  await prisma.site.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(),
      type: input.type || 'paid',
      price: price > 0 ? price : null,
      vat: vat > 0 ? vat : null,
      locationLat: input.locationLat,
      locationLng: input.locationLng,
    },
  })

  await prisma.$executeRaw`
    UPDATE "Site" SET coords = ST_MakePoint(${input.locationLat}::double precision, ${input.locationLng}::double precision)
    WHERE id = ${input.id}`

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Create / Update Site (form action) ─────────────────────────────────────

export async function submitForm(
  previousState: { status: string; errors?: string[] },
  formData: FormData
) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const requiredFields = ['name', 'locationLat', 'locationLng']
  const errors = requiredFields
    .filter((field) => !formData.get(field))
    .map((field) => `${field} is required`)

  const priceVal = formData.get('price') as string
  if (priceVal && isNaN(Number(priceVal))) {
    errors.push(`Invalid price ${priceVal}`)
  }

  if (errors.length > 0) return { status: 'error', errors }

  const siteId = formData.get('id') as string
  const price = Number(priceVal)

  const siteData = {
    name: formData.get('name') as string,
    type: (formData.get('type') as string) || 'paid',
    price: price > 0 ? price : null,
    locationLat: formData.get('locationLat') as string,
    locationLng: formData.get('locationLng') as string,
    user: { connect: { id: session.user.id } },
  }

  if (!siteId) {
    const { id: newSiteId } = await prisma.site.create({ data: siteData })

    await prisma.$executeRaw`
      UPDATE "Site" SET coords = ST_MakePoint(location_lat::double precision, location_lng::double precision)
      WHERE id = ${newSiteId}`

    revalidatePath('/sites')
    return { status: 'ok', siteId: newSiteId }
  }

  const site = await prisma.site.findFirst({ where: { id: siteId } })
  if (!site) return { status: 'error', errors: ['Site not found'] }

  await prisma.site.update({ data: siteData, where: { id: siteId } })

  await prisma.$executeRaw`
    UPDATE "Site" SET coords = ST_MakePoint(${siteData.locationLat}::double precision, ${siteData.locationLng}::double precision)
    WHERE id = ${siteId}`

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Delete Site ────────────────────────────────────────────────────────────

export async function deleteSite(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  await prisma.site.delete({ where: { id } })
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Toggle Site Status ─────────────────────────────────────────────────────

export async function setSiteStatus(id: string, status: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  await prisma.site.update({ where: { id }, data: { status } })
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Set Payment Provider ───────────────────────────────────────────────────

export async function setPaymentProvider(
  siteId: string,
  paymentProvider: string,
): Promise<{ status: string; errors?: string[] }> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  if (!['stripe', 'mollie'].includes(paymentProvider)) {
    return { status: 'error', errors: ['Invalid payment provider'] }
  }

  // If switching to Mollie, verify the partner has connected their Mollie account
  if (paymentProvider === 'mollie') {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId: session.user.id },
      select: { mollieAccessToken: true },
    })
    if (!account?.mollieAccessToken) {
      return {
        status: 'error',
        errors: ['Connect your Mollie account first (Account → Mollie Payments)'],
      }
    }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { paymentProvider },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}
