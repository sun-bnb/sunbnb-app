'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { validateImageFile, safeBlobKey } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'

// ─── Save Content Fields ────────────────────────────────────────────────────

export async function saveContentFields(input: {
  id: string
  description: string
  services: string[]
}): Promise<{ status: string; errors?: string[] }> {
  const { error } = await requireSiteOwner(input.id)
  if (error) return { status: 'error', errors: [error] }

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
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const imageFile = formData.get('image') as File
  if (!imageFile || imageFile.size === 0) {
    return { status: 'error', errors: ['No image provided'] }
  }

  const fileCheck = validateImageFile(imageFile)
  if (!fileCheck.ok) return { status: 'error', errors: [fileCheck.error] }

  const buffer = Buffer.from(await imageFile.arrayBuffer())
  const image = sharp(buffer)
  const metadata = await image.metadata()

  const siteData: Record<string, unknown> = {}
  if (metadata.width && metadata.height) {
    siteData.imageWidth = metadata.width
    siteData.imageHeight = metadata.height
  }

  const blob = await put(safeBlobKey(`sites/${siteId}/content`, imageFile), imageFile, { access: 'public' })
  siteData.image = blob.url

  await prisma.site.update({ data: siteData, where: { id: siteId } })

  revalidatePath('/sites')
  return { status: 'ok', imageUrl: blob.url }
}
