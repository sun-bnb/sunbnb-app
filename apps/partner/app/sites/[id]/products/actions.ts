'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import dayjs from 'dayjs'
import { Product, SiteProps } from '@/types/shared'
import { group } from 'console'

export async function addProduct(
  product: {
    siteId: string
    name: string
    description?: string
    totalPrice: number
    tax: number
  }
) {
  
  const session = await auth()
  console.log('ADD PRODUCT', session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const priceBeforeTax = product.totalPrice / (1 + product.tax / 100)
  const price = +priceBeforeTax.toFixed(2)

  const productData = {
    siteId: product.siteId,
    name: product.name,
    description: product.description,
    price: price,
    tax: product.tax,
    totalPrice: product.totalPrice
  }

  console.log('CREATE PRODUCT', productData)
  await prisma.product.create({
    data: productData
  })

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