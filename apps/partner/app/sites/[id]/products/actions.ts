'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { validateImageFile, isValidOrderPaymentType, isValidProductCategory } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import { computeVatAndBaseAmounts } from '@repo/data/payment'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import { Product } from '@/types/shared'

export async function toggleAppSales(siteId: string, enabled: boolean) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.site.update({
    where: { id: siteId },
    data: { appSalesEnabled: enabled },
  })

  revalidatePath(`/sites/${siteId}`)
  return { status: 'ok' }
}

export async function setOrderPaymentType(siteId: string, orderPaymentType: string) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (!isValidOrderPaymentType(orderPaymentType)) {
    return { status: 'error', errors: ['Invalid order payment type'] }
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { orderPaymentType },
  })

  revalidatePath(`/sites/${siteId}`)
  return { status: 'ok' }
}

export async function addProduct(formData: FormData) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  const siteId      = formData.get('siteId') as string

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const name        = formData.get('name') as string
  const description = (formData.get('description') as string) || undefined
  const totalPrice  = parseFloat(formData.get('totalPrice') as string)
  const taxPercent  = parseFloat(formData.get('tax') as string)
  const category    = (formData.get('category') as string) || 'food'
  const prepTimeRaw = formData.get('prepTime') as string | null
  const prepTime    = prepTimeRaw ? parseInt(prepTimeRaw, 10) || null : null
  const file        = formData.get('image') as File | null

  if (!isValidProductCategory(category)) {
    return { status: 'error', errors: ['Invalid product category'] }
  }

  // Input validation
  if (!name || name.length > 200) {
    return { status: 'error', errors: ['Product name is required and must be max 200 characters'] }
  }
  if (description !== undefined && description !== null && String(description).length > 1000) {
    return { status: 'error', errors: ['Description must be max 1000 characters'] }
  }
  if (isNaN(totalPrice) || totalPrice <= 0 || totalPrice > 100000) {
    return { status: 'error', errors: ['Price must be a positive number (max 100,000)'] }
  }
  if (isNaN(taxPercent) || taxPercent < 0 || taxPercent > 100) {
    return { status: 'error', errors: ['Tax percent must be between 0 and 100'] }
  }
  if (prepTime !== null && prepTime !== undefined && (isNaN(Number(prepTime)) || Number(prepTime) < 0)) {
    return { status: 'error', errors: ['Prep time must be a non-negative number'] }
  }

  const { baseAmount: price } = computeVatAndBaseAmounts(totalPrice, taxPercent)

  let productData: any = {
    siteId,
    name,
    description,
    price,
    tax: taxPercent,
    totalPrice,
    category,
    prepTime,
  }

  if (file && file.size > 0) {
    const fileCheck = validateImageFile(file)
    if (!fileCheck.ok) return { status: 'error', errors: [fileCheck.error] }

    const buffer = Buffer.from(await file.arrayBuffer())
    const meta   = await sharp(buffer).metadata()
    const ext    = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'}[file.type]) || 'bin'
    const key    = `sites/${siteId}/products/${crypto.randomUUID()}.${ext}`
    const blob   = await put(key, buffer, {
      access: 'public',
      contentType: file.type,
    })

    if (meta?.width && meta.height) {
      productData.imageWidth = meta.width
      productData.imageHeight = meta.height
    }
    if (blob?.url) {
      productData.imageUrl = blob.url
    }
  }

  await prisma.product.create({ data: productData })
  revalidatePath('/sites')
  return { status: 'ok' }
}

export async function updateProduct(
  id: string,
  data: {
    name?: string
    description?: string | null
    totalPrice?: number
    tax?: number
    category?: string
    prepTime?: number | null
  }
) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  // Input validation
  if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length === 0 || data.name.length > 200)) {
    return { status: 'error', errors: ['Product name must be 1–200 characters'] }
  }
  if (data.description !== undefined && data.description !== null && String(data.description).length > 1000) {
    return { status: 'error', errors: ['Description must be max 1000 characters'] }
  }
  if (data.totalPrice !== undefined && (isNaN(data.totalPrice) || data.totalPrice <= 0 || data.totalPrice > 100000)) {
    return { status: 'error', errors: ['Price must be a positive number (max 100,000)'] }
  }
  if (data.tax !== undefined && (isNaN(data.tax) || data.tax < 0 || data.tax > 100)) {
    return { status: 'error', errors: ['Tax percent must be between 0 and 100'] }
  }
  if (data.prepTime !== undefined && data.prepTime !== null && (isNaN(Number(data.prepTime)) || Number(data.prepTime) < 0)) {
    return { status: 'error', errors: ['Prep time must be a non-negative number'] }
  }
  if (data.category !== undefined && !isValidProductCategory(data.category)) {
    return { status: 'error', errors: ['Invalid product category'] }
  }

  const product = await prisma.product.findUnique({
    where: { id },
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!product || product.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const updateData: Record<string, any> = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.description !== undefined) updateData.description = data.description
  if (data.category !== undefined) updateData.category = data.category
  if (data.prepTime !== undefined) updateData.prepTime = data.prepTime
  if (data.totalPrice !== undefined && data.tax !== undefined) {
    const { baseAmount } = computeVatAndBaseAmounts(data.totalPrice, data.tax)
    updateData.price = baseAmount
    updateData.tax = data.tax
    updateData.totalPrice = data.totalPrice
  } else if (data.totalPrice !== undefined) {
    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return { status: 'error', errors: ['Product not found'] }
    const { baseAmount } = computeVatAndBaseAmounts(data.totalPrice, existing.tax)
    updateData.price = baseAmount
    updateData.totalPrice = data.totalPrice
  } else if (data.tax !== undefined) {
    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return { status: 'error', errors: ['Product not found'] }
    const { baseAmount } = computeVatAndBaseAmounts(existing.totalPrice, data.tax)
    updateData.price = baseAmount
    updateData.tax = data.tax
  }

  await prisma.product.update({ where: { id }, data: updateData })
  return { status: 'ok' }
}

export async function updateProductImage(id: string, formData: FormData) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const file = formData.get('image') as File | null
  if (!file || file.size === 0) return { status: 'error', errors: ['No image'] }

  const fileCheck = validateImageFile(file)
  if (!fileCheck.ok) return { status: 'error', errors: [fileCheck.error] }

  const product = await prisma.product.findUnique({
    where: { id },
    select: { siteId: true, site: { select: { userId: true } } },
  })
  if (!product || product.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const meta   = await sharp(buffer).metadata()
  const ext    = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'}[file.type]) || 'bin'
  const key    = `sites/${product.siteId}/products/${crypto.randomUUID()}.${ext}`
  const blob   = await put(key, buffer, {
    access: 'public',
    contentType: file.type,
  })

  await prisma.product.update({
    where: { id },
    data: {
      imageUrl: blob.url,
      ...(meta?.width && meta.height
        ? { imageWidth: meta.width, imageHeight: meta.height }
        : {}),
    },
  })

  return { status: 'ok', imageUrl: blob.url }
}

export async function deleteProduct(id: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const product = await prisma.product.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!product || product.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.product.update({
    where: { id },
    data: { active: false },
  })

  return { status: 'ok' }
}

export async function toggleProductSoldOut(id: string, soldOut: boolean) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const product = await prisma.product.findUnique({
    where: { id },
    select: { site: { select: { userId: true } } },
  })
  if (!product || product.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.product.update({ where: { id }, data: { soldOut } })
  return { status: 'ok' }
}

export async function getProducts(siteId: string): Promise<Product[]> {
  const { error } = await requireSiteOwner(siteId)
  if (error) return []

  return prisma.product.findMany({
    where: { siteId, active: true },
  })
}