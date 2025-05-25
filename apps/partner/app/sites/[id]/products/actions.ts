'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import dayjs from 'dayjs'
import { Product, SiteProps } from '@/types/shared'
import { group } from 'console'

export async function addProduct(formData: FormData) {
  // 1) Authentication
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  // 2) Extract fields from the FormData
  const siteId      = formData.get('siteId') as string
  const name        = formData.get('name') as string
  const description = (formData.get('description') as string) || undefined
  const totalPrice  = parseFloat(formData.get('totalPrice') as string)
  const taxPercent  = parseFloat(formData.get('tax') as string)
  const file        = formData.get('image') as File | null

  // 3) Compute pre-tax price
  const priceBeforeTax = totalPrice / (1 + taxPercent / 100)
  const price          = +priceBeforeTax.toFixed(2)

  // 4) Base product data
  let productData = {
    siteId,
    name,
    description,
    price,
    tax: taxPercent,
    totalPrice,
  }

  // 5) If an image was uploaded, process & upload
  if (file && file.size > 0) {
    const buffer   = Buffer.from(await file.arrayBuffer())
    const image    = sharp(buffer)
    const meta     = await image.metadata()

    // upload to your blob store; name it uniquely
    const ext     = file.type.split('/')[1]
    const key     = `sites/${siteId}/products/${crypto.randomUUID()}.${ext}`
    const blob    = await put(key, buffer, {
      access: 'public',
      contentType: file.type,
    })

    productData = {
      ...productData,
      // these fields only if we actually set them below
      ...(meta?.width && meta.height
        ? { imageWidth: meta.width, imageHeight: meta.height }
        : {}),
      ...(blob?.url ? { imageUrl: blob.url } : {}),
    }
    
  }

  
  // 6) Persist
  await prisma.product.create({ data: productData })

  revalidatePath('/sites')

  return { status: 'ok' }
  
}


export async function deleteProduct(
  id: string
) {
  
  const session = await auth();
  console.log('GET PRODUCTS', session);

  await prisma.product.update({
    where: { id: id },
    data: { active: false }
  })

  return { status: 'ok' }
  
}

export async function getProducts(siteId: string): Promise<Product[]> {

  const session = await auth();
  console.log('GET PRODUCTS', session);

  const products = await prisma.product.findMany({
    where: { siteId: siteId, active: true },
  })

  return products;
}