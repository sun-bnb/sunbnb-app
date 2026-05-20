'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidSiteStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import { getEffectiveSubscriptionForUser } from '@repo/data/subscription'

// ─── Save Schematic Canvas Dimensions ───────────────────────────────────────

export async function saveLayoutDimensions(
  siteId: string,
  width: number,
  height: number,
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error' as const, errors: [error] }

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { status: 'error' as const, errors: ['Invalid dimensions'] }
  }
  if (width < 5 || height < 5 || width > 500 || height > 500) {
    return { status: 'error' as const, errors: ['Dimensions out of range'] }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { layoutWidth: width, layoutHeight: height },
  })

  revalidatePath('/sites')
  return { status: 'ok' as const }
}

// ─── Save General Settings ──────────────────────────────────────────────────

export async function saveGeneral(input: {
  id: string
  name: string
  type: string
  price: string
  vat: string
  locationLat: string
  locationLng: string
  layoutMode?: string
  layoutWidth?: string
  layoutHeight?: string
}): Promise<{ status: string; errors?: string[] }> {
  const { session, error } = await requireSiteOwner(input.id)
  if (error) return { status: 'error', errors: [error] }

  const errors: string[] = []
  if (!input.name?.trim()) errors.push('Site name is required')
  if (input.name && input.name.length > 200) errors.push('Site name is too long (max 200)')
  if (!input.locationLat || !input.locationLng) errors.push('Location is required')

  const validTypes = ['paid', 'unpaid']
  if (input.type && !validTypes.includes(input.type)) {
    errors.push('Invalid site type')
  }

  const price = Number(input.price)
  const vat = Number(input.vat)

  if (input.price && isNaN(price)) errors.push('Invalid price')
  if (input.price && !isNaN(price) && (price < 0 || price > 100000)) errors.push('Price must be 0–100,000')
  if (input.vat && isNaN(vat)) errors.push('Invalid VAT')
  if (input.vat && !isNaN(vat) && (vat < 0 || vat > 100)) errors.push('VAT must be 0–100')

  // Validate lat/lng are numeric
  const lat = Number(input.locationLat)
  const lng = Number(input.locationLng)
  if (isNaN(lat) || lat < -90 || lat > 90) errors.push('Invalid latitude')
  if (isNaN(lng) || lng < -180 || lng > 180) errors.push('Invalid longitude')

  const wantsLayoutChange =
    input.layoutMode !== undefined ||
    input.layoutWidth !== undefined ||
    input.layoutHeight !== undefined

  if (input.layoutMode !== undefined && !['geo', 'schematic'].includes(input.layoutMode)) {
    errors.push('Invalid layout mode')
  }

  let layoutWidth: number | null | undefined
  let layoutHeight: number | null | undefined
  if (input.layoutWidth !== undefined) {
    if (input.layoutWidth === '') {
      layoutWidth = null
    } else {
      const w = Number(input.layoutWidth)
      if (isNaN(w) || w <= 0 || w > 1000) errors.push('Layout width must be 1–1000 m')
      else layoutWidth = w
    }
  }
  if (input.layoutHeight !== undefined) {
    if (input.layoutHeight === '') {
      layoutHeight = null
    } else {
      const h = Number(input.layoutHeight)
      if (isNaN(h) || h <= 0 || h > 1000) errors.push('Layout height must be 1–1000 m')
      else layoutHeight = h
    }
  }

  if (errors.length > 0) return { status: 'error', errors }

  // Hard-lock: refuse layoutMode switch when inventory items exist.
  if (input.layoutMode !== undefined) {
    const current = await prisma.site.findUnique({
      where: { id: input.id },
      select: { layoutMode: true, _count: { select: { inventoryItems: true } } },
    })
    if (current && current.layoutMode !== input.layoutMode && current._count.inventoryItems > 0) {
      return {
        status: 'error',
        errors: ['Cannot change layout mode after inventory items exist'],
      }
    }
  }

  // Entitlement check: off-platform billing (type:'unpaid') requires the feature
  if (input.type === 'unpaid' && session) {
    const effective = await getEffectiveSubscriptionForUser(session.user.id)
    if (!effective.features.OFF_PLATFORM_BILLING) {
      return {
        status: 'error',
        errors: ['Off-platform billing requires a Pro/Business plan or an admin override'],
      }
    }
  }

  const layoutData: Record<string, unknown> = {}
  if (input.layoutMode !== undefined) layoutData.layoutMode = input.layoutMode
  if (layoutWidth !== undefined) layoutData.layoutWidth = layoutWidth
  if (layoutHeight !== undefined) layoutData.layoutHeight = layoutHeight

  await prisma.site.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(),
      type: input.type || 'paid',
      price: price > 0 ? price : null,
      vat: vat > 0 ? vat : null,
      locationLat: input.locationLat,
      locationLng: input.locationLng,
      ...(wantsLayoutChange ? layoutData : {}),
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

  const siteId = formData.get('id') as string
  if (siteId) {
    const { error } = await requireSiteOwner(siteId)
    if (error) return { status: 'error', errors: [error] }
  }

  const requiredFields = ['name', 'locationLat', 'locationLng']
  const errors = requiredFields
    .filter((field) => !formData.get(field))
    .map((field) => `${field} is required`)

  const nameVal = formData.get('name') as string
  if (nameVal && nameVal.length > 200) errors.push('Site name is too long (max 200)')

  const priceVal = formData.get('price') as string
  if (priceVal && isNaN(Number(priceVal))) {
    errors.push(`Invalid price ${priceVal}`)
  }
  if (priceVal && !isNaN(Number(priceVal)) && (Number(priceVal) < 0 || Number(priceVal) > 100000)) {
    errors.push('Price must be 0–100,000')
  }

  // Validate lat/lng
  const latVal = formData.get('locationLat') as string
  const lngVal = formData.get('locationLng') as string
  if (latVal && (isNaN(Number(latVal)) || Number(latVal) < -90 || Number(latVal) > 90)) errors.push('Invalid latitude')
  if (lngVal && (isNaN(Number(lngVal)) || Number(lngVal) < -180 || Number(lngVal) > 180)) errors.push('Invalid longitude')

  if (errors.length > 0) return { status: 'error', errors }

  const price = Number(priceVal)

  // Entitlement check: off-platform billing (type:'unpaid') requires the feature
  const typeVal = (formData.get('type') as string) || 'paid'
  if (typeVal === 'unpaid') {
    const effective = await getEffectiveSubscriptionForUser(session.user.id)
    if (!effective.features.OFF_PLATFORM_BILLING) {
      return {
        status: 'error',
        errors: ['Off-platform billing requires a Pro/Business plan or an admin override'],
      }
    }
  }

  const siteData = {
    name: formData.get('name') as string,
    type: typeVal,
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
  const { error } = await requireSiteOwner(id)
  if (error) return { status: 'error', errors: [error] }

  await prisma.site.delete({ where: { id } })
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Toggle Site Status ─────────────────────────────────────────────────────

export async function setSiteStatus(id: string, status: string) {
  const { error } = await requireSiteOwner(id)
  if (error) return { status: 'error', errors: [error] }

  if (!isValidSiteStatus(status)) {
    return { status: 'error', errors: ['Invalid site status'] }
  }

  await prisma.site.update({ where: { id }, data: { status } })
  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Set Payment Provider ───────────────────────────────────────────────────

export async function setPaymentProvider(
  siteId: string,
  paymentProvider: string,
): Promise<{ status: string; errors?: string[] }> {
  const { session, error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

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

// ─── Get Brand Settings ─────────────────────────────────────────────────────

export async function getBrand(siteId: string) {
  const session = await auth()
  if (!session?.user) return null

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { slug: true, name: true, brand: true },
  })

  return site
}

// ─── Check Slug Availability ────────────────────────────────────────────────

export async function checkSlug(
  slug: string,
  siteId: string,
): Promise<{ available: boolean }> {
  const session = await auth()
  if (!session?.user) return { available: false }

  if (slug.length > 100) return { available: false }
  const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!normalized || normalized.length < 3) return { available: false }

  const existing = await prisma.site.findFirst({
    where: { slug: normalized, id: { not: siteId } },
  })

  return { available: !existing }
}

// ─── Generate Unique Slug From Site Name ────────────────────────────────────

export async function generateSlug(
  siteName: string,
  siteId: string,
): Promise<string> {
  const session = await auth()
  if (!session?.user) return ''

  if (siteName.length > 200) return ''

  const base = siteName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!base) return ''

  // Check if base slug is free
  const existing = await prisma.site.findFirst({
    where: { slug: base, id: { not: siteId } },
  })
  if (!existing) return base

  // Try base-1, base-2, etc.
  for (let i = 1; i <= 100; i++) {
    const candidate = `${base}-${i}`
    const taken = await prisma.site.findFirst({
      where: { slug: candidate, id: { not: siteId } },
    })
    if (!taken) return candidate
  }

  return `${base}-${Date.now()}`
}

// ─── Save Brand Settings ────────────────────────────────────────────────────

export async function saveBrand(input: {
  siteId: string
  brandName: string
  slug: string
  tagline: string
  bgColor: string
  fgColor: string
}): Promise<{ status: string; errors?: string[] }> {
  const { error } = await requireSiteOwner(input.siteId)
  if (error) return { status: 'error', errors: [error] }

  const errors: string[] = []
  if (!input.brandName?.trim()) errors.push('Brand name is required')
  if (input.brandName && input.brandName.length > 200) errors.push('Brand name is too long (max 200)')
  if (input.tagline && input.tagline.length > 500) errors.push('Tagline is too long (max 500)')
  if (input.bgColor && !/^#[0-9a-fA-F]{3,8}$/.test(input.bgColor)) errors.push('Invalid background color')
  if (input.fgColor && !/^#[0-9a-fA-F]{3,8}$/.test(input.fgColor)) errors.push('Invalid foreground color')

  // Validate slug format
  const slug = input.slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || null
  if (slug) {
    if (slug.length < 3) errors.push('Slug must be at least 3 characters')
    if (slug.length > 60) errors.push('Slug must be at most 60 characters')
    // Check uniqueness
    const existing = await prisma.site.findFirst({
      where: { slug, id: { not: input.siteId } },
    })
    if (existing) errors.push('This URL slug is already taken')
  }

  if (errors.length > 0) return { status: 'error', errors }

  // Update slug on the Site itself
  await prisma.site.update({
    where: { id: input.siteId },
    data: { slug },
  })

  // Upsert the brand record
  await prisma.siteBrand.upsert({
    where: { siteId: input.siteId },
    create: {
      siteId: input.siteId,
      brandName: input.brandName.trim(),
      tagline: input.tagline?.trim() || null,
      bgColor: input.bgColor || '#faf9f6',
      fgColor: input.fgColor || '#111827',
    },
    update: {
      brandName: input.brandName.trim(),
      tagline: input.tagline?.trim() || null,
      bgColor: input.bgColor || '#faf9f6',
      fgColor: input.fgColor || '#111827',
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}
