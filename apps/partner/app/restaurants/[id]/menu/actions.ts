'use server'

import { revalidatePath } from 'next/cache'
import crypto from 'node:crypto'
import { put } from '@vercel/blob'
import { requireRestaurantOwnerWithFlag } from '@/lib/auth-helpers'
import { validateImageFile } from '@/lib/validation'
import {
  createMenuItem,
  updateMenuItem,
  archiveMenuItem,
  setMenuItemSoldOut,
  reorderMenuItems,
  type MenuItemInput,
} from '@repo/table-reservations-core'

type AuthOk = { ok: true; userId: string }
type AuthErr = { ok: false; error: string }

async function requireAuth(restaurantId: string): Promise<AuthOk | AuthErr> {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { ok: false, error }
  return { ok: true, userId: session!.user.id as string }
}

async function uploadMenuItemImage(
  restaurantId: string,
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
  const key = `restaurants/${restaurantId}/menu/${crypto.randomUUID()}.${ext}`
  const blob = await put(key, buffer, { access: 'public', contentType: file.type })
  return { ok: true, url: blob.url }
}

export async function createMenuItemForRestaurant(restaurantId: string, formData: FormData) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const totalPriceRaw = String(formData.get('totalPrice') ?? '0')
  const taxRaw = String(formData.get('tax') ?? '0')
  const category = String(formData.get('category') ?? 'main').trim() || 'main'
  const imageUrlField = formData.get('imageUrl')
  const imageFile = formData.get('imageFile') as File | null

  const totalPrice = Number(totalPriceRaw)
  const tax = Number(taxRaw)
  if (!Number.isFinite(totalPrice)) return { status: 'error' as const, errors: ['Invalid price'] }
  if (!Number.isFinite(tax)) return { status: 'error' as const, errors: ['Invalid VAT'] }

  let imageUrl: string | null = null
  if (typeof imageUrlField === 'string' && imageUrlField.length > 0) {
    imageUrl = imageUrlField
  }
  if (imageFile && imageFile.size > 0) {
    const up = await uploadMenuItemImage(restaurantId, imageFile)
    if (!up.ok) return { status: 'error' as const, errors: [up.error] }
    imageUrl = up.url
  }

  const res = await createMenuItem(
    restaurantId,
    { name, description: description || null, totalPrice, tax, category, imageUrl } as MenuItemInput,
    r.userId,
  )
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/menu`)
  return res
}

export async function updateMenuItemForRestaurant(
  restaurantId: string,
  menuItemId: string,
  formData: FormData,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const name = formData.get('name')
  const description = formData.get('description')
  const totalPriceRaw = formData.get('totalPrice')
  const taxRaw = formData.get('tax')
  const category = formData.get('category')
  const imageUrlField = formData.get('imageUrl')
  const removeImage = formData.get('removeImage') === '1'
  const imageFile = formData.get('imageFile') as File | null

  const patch: Partial<MenuItemInput> = {}
  if (typeof name === 'string') patch.name = name.trim()
  if (typeof description === 'string') patch.description = description.trim() || null
  if (typeof totalPriceRaw === 'string' && totalPriceRaw.length > 0) {
    const totalPrice = Number(totalPriceRaw)
    if (!Number.isFinite(totalPrice)) return { status: 'error' as const, errors: ['Invalid price'] }
    patch.totalPrice = totalPrice
  }
  if (typeof taxRaw === 'string' && taxRaw.length > 0) {
    const tax = Number(taxRaw)
    if (!Number.isFinite(tax)) return { status: 'error' as const, errors: ['Invalid VAT'] }
    patch.tax = tax
  }
  if (typeof category === 'string') patch.category = category.trim() || 'main'

  if (imageFile && imageFile.size > 0) {
    const up = await uploadMenuItemImage(restaurantId, imageFile)
    if (!up.ok) return { status: 'error' as const, errors: [up.error] }
    patch.imageUrl = up.url
  } else if (removeImage) {
    patch.imageUrl = null
  } else if (typeof imageUrlField === 'string') {
    patch.imageUrl = imageUrlField
  }

  const res = await updateMenuItem(menuItemId, patch, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/menu`)
  return res
}

export async function archiveMenuItemForRestaurant(restaurantId: string, menuItemId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await archiveMenuItem(menuItemId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/menu`)
  return res
}

export async function setMenuItemSoldOutForRestaurant(
  restaurantId: string,
  menuItemId: string,
  soldOut: boolean,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await setMenuItemSoldOut(menuItemId, soldOut, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/menu`)
  return res
}

export async function reorderMenuItemsForRestaurant(restaurantId: string, orderedIds: string[]) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await reorderMenuItems(restaurantId, orderedIds, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/menu`)
  return res
}
