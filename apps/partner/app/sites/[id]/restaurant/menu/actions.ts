'use server'

import { revalidatePath } from 'next/cache'
import crypto from 'node:crypto'
import { put } from '@vercel/blob'
import { requireSiteOwnerWithFlag } from '@/lib/auth-helpers'
import { validateImageFile } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import {
  createMenuItem,
  updateMenuItem,
  archiveMenuItem,
  setMenuItemSoldOut,
  reorderMenuItems,
  type MenuItemInput,
} from '@repo/table-reservations-core'

type LinkedOk = { ok: true; restaurantId: string; userId: string }
type LinkedErr = { ok: false; error: string }

async function requireLinkedRestaurant(siteId: string): Promise<LinkedOk | LinkedErr> {
  const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
  if (error) return { ok: false, error }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) return { ok: false, error: 'Site has no linked restaurant' }
  return { ok: true, restaurantId: site.restaurantId, userId: session!.user.id as string }
}

/**
 * Upload a menu-item image to Vercel Blob and return the public URL.
 * Partner-side only: content-type and size validation happens via
 * validateImageFile; the path namespaces blobs under the owning site.
 */
async function uploadMenuItemImage(
  siteId: string,
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const check = validateImageFile(file)
  if (!check.ok) return { ok: false, error: check.error }

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext =
    (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
      } as Record<string, string>
    )[file.type] ?? 'bin'
  const key = `sites/${siteId}/menu/${crypto.randomUUID()}.${ext}`
  const blob = await put(key, buffer, { access: 'public', contentType: file.type })
  return { ok: true, url: blob.url }
}

export async function createMenuItemForSite(siteId: string, formData: FormData) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const priceRaw = String(formData.get('price') ?? '0')
  const category = String(formData.get('category') ?? 'main').trim() || 'main'
  const imageUrlField = formData.get('imageUrl')
  const imageFile = formData.get('imageFile') as File | null

  const price = Number(priceRaw)
  if (!Number.isFinite(price)) return { status: 'error' as const, errors: ['Invalid price'] }

  let imageUrl: string | null = null
  if (typeof imageUrlField === 'string' && imageUrlField.length > 0) {
    imageUrl = imageUrlField
  }
  if (imageFile && imageFile.size > 0) {
    const up = await uploadMenuItemImage(siteId, imageFile)
    if (!up.ok) return { status: 'error' as const, errors: [up.error] }
    imageUrl = up.url
  }

  const res = await createMenuItem(
    r.restaurantId,
    {
      name,
      description: description || null,
      price,
      category,
      imageUrl,
    } as MenuItemInput,
    r.userId,
  )
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/menu`)
  return res
}

export async function updateMenuItemForSite(
  siteId: string,
  menuItemId: string,
  formData: FormData,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const name = formData.get('name')
  const description = formData.get('description')
  const priceRaw = formData.get('price')
  const category = formData.get('category')
  const imageUrlField = formData.get('imageUrl')
  const removeImage = formData.get('removeImage') === '1'
  const imageFile = formData.get('imageFile') as File | null

  const patch: Partial<MenuItemInput> = {}
  if (typeof name === 'string') patch.name = name.trim()
  if (typeof description === 'string') patch.description = description.trim() || null
  if (typeof priceRaw === 'string' && priceRaw.length > 0) {
    const price = Number(priceRaw)
    if (!Number.isFinite(price)) return { status: 'error' as const, errors: ['Invalid price'] }
    patch.price = price
  }
  if (typeof category === 'string') patch.category = category.trim() || 'main'

  if (imageFile && imageFile.size > 0) {
    const up = await uploadMenuItemImage(siteId, imageFile)
    if (!up.ok) return { status: 'error' as const, errors: [up.error] }
    patch.imageUrl = up.url
  } else if (removeImage) {
    patch.imageUrl = null
  } else if (typeof imageUrlField === 'string') {
    patch.imageUrl = imageUrlField
  }

  const res = await updateMenuItem(menuItemId, patch, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/menu`)
  return res
}

export async function archiveMenuItemForSite(siteId: string, menuItemId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await archiveMenuItem(menuItemId, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/menu`)
  return res
}

export async function setMenuItemSoldOutForSite(
  siteId: string,
  menuItemId: string,
  soldOut: boolean,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await setMenuItemSoldOut(menuItemId, soldOut, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/menu`)
  return res
}

export async function reorderMenuItemsForSite(siteId: string, orderedIds: string[]) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await reorderMenuItems(r.restaurantId, orderedIds, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/menu`)
  return res
}
