'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'

// ─── Save Content Fields ────────────────────────────────────────────────────

export async function saveContentFields(input: {
  id: string
  description: string
  services: string[]
}): Promise<{ status: string; errors?: string[] }> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const site = await prisma.site.findFirst({ where: { id: input.id } })
  if (!site) return { status: 'error', errors: ['Site not found'] }

  await prisma.site.update({
    where: { id: input.id },
    data: {
      description: input.description,
      services: input.services,
    },
  })

  revalidatePath('/sites')
  return { status: 'ok' }
}

// ─── Upload Content Image ───────────────────────────────────────────────────

export async function uploadContentImage(
  siteId: string,
  formData: FormData
): Promise<{ status: string; imageUrl?: string; errors?: string[] }> {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const imageFile = formData.get('image') as File
  if (!imageFile || imageFile.size === 0) {
    return { status: 'error', errors: ['No image provided'] }
  }

  const buffer = Buffer.from(await imageFile.arrayBuffer())
  const image = sharp(buffer)
  const metadata = await image.metadata()

  const siteData: Record<string, unknown> = {}
  if (metadata.width && metadata.height) {
    siteData.imageWidth = metadata.width
    siteData.imageHeight = metadata.height
  }

  const blob = await put(imageFile.name, imageFile, { access: 'public' })
  siteData.image = blob.url

  await prisma.site.update({ data: siteData, where: { id: siteId } })

  revalidatePath('/sites')
  return { status: 'ok', imageUrl: blob.url }
}
