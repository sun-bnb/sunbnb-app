'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'

interface CreateSiteInput {
  name: string
  locationLat: string
  locationLng: string
  type: string
  price: string
  vat: string
  workingHours: { day: string; openTime: string; closeTime: string }[]
  description: string
  services: string[]
  siteId: string | null
}

export async function createSite(
  input: CreateSiteInput
): Promise<{ status: string; siteId?: string; errors?: string[] }> {

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  // Validate required fields
  const errors: string[] = []
  if (!input.name.trim()) errors.push('Site name is required')
  if (!input.locationLat || !input.locationLng) errors.push('Site location is required')
  if (errors.length > 0) return { status: 'error', errors }

  const price = Number(input.price)
  const vat = Number(input.vat)

  // 1. Create the site
  const { id: siteId } = await prisma.site.create({
    data: {
      name: input.name.trim(),
      type: input.type || 'paid',
      price: price > 0 ? price : null,
      vat: vat > 0 ? vat : null,
      locationLat: input.locationLat,
      locationLng: input.locationLng,
      description: input.description || null,
      services: input.services,
      user: { connect: { id: session.user.id } },
    },
  })

  // 2. Set PostGIS coords
  await prisma.$executeRaw`
    UPDATE "Site" SET coords = ST_MakePoint(${input.locationLat}::double precision, ${input.locationLng}::double precision)
    WHERE id = ${siteId}`

  // 3. Create working hours
  for (const wh of input.workingHours) {
    const openTime = new Date('2000-01-01T' + wh.openTime + ':00.000')
    const closeTime = new Date('2000-01-01T' + wh.closeTime + ':00.000')
    await prisma.siteWorkingHours.create({
      data: {
        day: Number(wh.day),
        openTime,
        closeTime,
        site: { connect: { id: siteId } },
      },
    })
  }

  revalidatePath('/sites')
  return { status: 'ok', siteId }
}

export async function uploadSiteImage(
  siteId: string,
  formData: FormData
): Promise<{ status: string; errors?: string[] }> {

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const imageFile = formData.get('image') as File
  if (!imageFile || imageFile.size === 0) {
    return { status: 'ok' } // no image, nothing to do
  }

  const buffer = Buffer.from(await imageFile.arrayBuffer())
  const image = sharp(buffer)
  const metadata = await image.metadata()

  const siteData: any = {}
  if (metadata.width && metadata.height) {
    siteData.imageWidth = metadata.width
    siteData.imageHeight = metadata.height
  }

  const blob = await put(imageFile.name, imageFile, { access: 'public' })
  siteData.image = blob.url

  await prisma.site.update({
    data: siteData,
    where: { id: siteId },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}
