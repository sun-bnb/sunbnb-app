'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { validateImageFile, safeBlobKey } from '@/lib/validation'
import { createSiteWithCode } from '@/lib/site-create'
import prisma from '@repo/data/PrismaCient'
import { canCreateSite, getEffectiveSubscriptionForUser } from '@repo/data/subscription'
import { planGateError } from '@/lib/plan-features'
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
}

export async function createSite(
  input: CreateSiteInput
): Promise<{ status: string; siteId?: string; errors?: string[] }> {

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  // Check subscription plan site limit
  const siteLimit = await canCreateSite(session.user.id!)
  if (!siteLimit.allowed) {
    return {
      status: 'error',
      errors: [`Your ${siteLimit.tier} plan allows up to ${siteLimit.maxSites} site(s). Please upgrade to add more.`],
    }
  }

  // Validate required fields
  const errors: string[] = []
  if (!input.name.trim()) errors.push('Site name is required')
  if (!input.locationLat || !input.locationLng) errors.push('Site location is required')
  if (errors.length > 0) return { status: 'error', errors }

  // Entitlement check: off-platform billing (type:'unpaid') requires the feature
  if (input.type === 'unpaid') {
    const effective = await getEffectiveSubscriptionForUser(session.user.id!)
    if (!effective.features.OFF_PLATFORM_BILLING) {
      return {
        status: 'error',
        errors: ['Pay-on-site mode is turned off for this account; contact Sunbnb support'],
      }
    }
  }

  const price = Number(input.price)
  const vat = Number(input.vat)

  // CR-002: the default site type is 'paid' (online payments). A partner whose plan lacks
  // ONLINE_PAYMENTS (Gratis) gets an unpaid, pay-on-site venue instead of a refusal.
  let siteType = input.type || 'paid'
  if (siteType === 'paid') {
    const gate = await planGateError(session.user.id!, ['ONLINE_PAYMENTS'])
    if (gate) siteType = 'unpaid'
  }

  // 1. Create the site (with its minted QR code — track 022)
  const { id: siteId } = await createSiteWithCode({
    name: input.name.trim(),
    type: siteType,
    price: price > 0 ? price : null,
    vat: vat > 0 ? vat : null,
    locationLat: input.locationLat,
    locationLng: input.locationLng,
    description: input.description || null,
    services: input.services,
    user: { connect: { id: session.user.id } },
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

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const imageFile = formData.get('image') as File
  if (!imageFile || imageFile.size === 0) {
    return { status: 'ok' } // no image, nothing to do
  }

  const fileCheck = validateImageFile(imageFile)
  if (!fileCheck.ok) return { status: 'error', errors: [fileCheck.error] }

  const buffer = Buffer.from(await imageFile.arrayBuffer())
  const image = sharp(buffer)
  const metadata = await image.metadata()

  const siteData: any = {}
  if (metadata.width && metadata.height) {
    siteData.imageWidth = metadata.width
    siteData.imageHeight = metadata.height
  }

  const blob = await put(safeBlobKey(`sites/${siteId}/content`, imageFile), imageFile, { access: 'public' })
  siteData.image = blob.url

  await prisma.site.update({
    data: siteData,
    where: { id: siteId },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}
