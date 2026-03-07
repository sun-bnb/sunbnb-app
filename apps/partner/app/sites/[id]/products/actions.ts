'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import { Product } from '@/types/shared'

export async function toggleAppSales(siteId: string, enabled: boolean) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  await prisma.site.update({
    where: { id: siteId },
    data: { appSalesEnabled: enabled },
  })

  revalidatePath(`/sites/${siteId}`)
  return { status: 'ok' }
}

export async function setOrderPaymentType(siteId: string, orderPaymentType: string) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

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
  const name        = formData.get('name') as string
  const description = (formData.get('description') as string) || undefined
  const totalPrice  = parseFloat(formData.get('totalPrice') as string)
  const taxPercent  = parseFloat(formData.get('tax') as string)
  const file        = formData.get('image') as File | null

  const priceBeforeTax = totalPrice / (1 + taxPercent / 100)
  const price          = +priceBeforeTax.toFixed(2)

  let productData: any = {
    siteId,
    name,
    description,
    price,
    tax: taxPercent,
    totalPrice,
  }

  if (file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const meta   = await sharp(buffer).metadata()
    const ext    = file.type.split('/')[1]
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
  }
) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const updateData: Record<string, any> = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.description !== undefined) updateData.description = data.description
  if (data.totalPrice !== undefined && data.tax !== undefined) {
    const priceBeforeTax = data.totalPrice / (1 + data.tax / 100)
    updateData.price = +priceBeforeTax.toFixed(2)
    updateData.tax = data.tax
    updateData.totalPrice = data.totalPrice
  } else if (data.totalPrice !== undefined) {
    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return { status: 'error', errors: ['Product not found'] }
    const priceBeforeTax = data.totalPrice / (1 + existing.tax / 100)
    updateData.price = +priceBeforeTax.toFixed(2)
    updateData.totalPrice = data.totalPrice
  } else if (data.tax !== undefined) {
    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return { status: 'error', errors: ['Product not found'] }
    const priceBeforeTax = existing.totalPrice / (1 + data.tax / 100)
    updateData.price = +priceBeforeTax.toFixed(2)
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

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return { status: 'error', errors: ['Product not found'] }

  const buffer = Buffer.from(await file.arrayBuffer())
  const meta   = await sharp(buffer).metadata()
  const ext    = file.type.split('/')[1]
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

  await prisma.product.update({
    where: { id },
    data: { active: false },
  })

  return { status: 'ok' }
}

export async function getProducts(siteId: string): Promise<Product[]> {
  const session = await auth()
  if (!session?.user) return []

  return prisma.product.findMany({
    where: { siteId, active: true },
  })
}