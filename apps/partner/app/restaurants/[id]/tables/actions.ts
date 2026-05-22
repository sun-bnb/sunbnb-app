'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantOwnerWithFlag } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import {
  createTable,
  duplicateTable,
  updateTable,
  deleteTable,
  createLayoutElement,
  updateLayoutElement,
  deleteLayoutElement,
  type TableInput,
  type LayoutElementInput,
} from '@repo/table-reservations-core'

type AuthOk = { ok: true; userId: string }
type AuthErr = { ok: false; error: string }

async function requireAuth(restaurantId: string): Promise<AuthOk | AuthErr> {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { ok: false, error }
  return { ok: true, userId: session!.user.id as string }
}

export async function createTableForRestaurant(
  restaurantId: string,
  at: { x: number; y: number },
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await createTable(
    restaurantId,
    { capacity: 4, shape: 'square', schematicX: at.x, schematicY: at.y },
    r.userId,
  )
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function updateTableForRestaurant(
  restaurantId: string,
  tableId: string,
  patch: Partial<TableInput>,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await updateTable(tableId, patch, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function duplicateTableForRestaurant(
  restaurantId: string,
  tableId: string,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await duplicateTable(tableId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return {
    status: res.status,
    errors: res.errors,
    tableId: res.table?.id,
  }
}

export async function deleteTableForRestaurant(restaurantId: string, tableId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await deleteTable(tableId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function createElementForRestaurant(
  restaurantId: string,
  input: LayoutElementInput,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await createLayoutElement(restaurantId, input, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function updateElementForRestaurant(
  restaurantId: string,
  elementId: string,
  patch: Partial<LayoutElementInput>,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await updateLayoutElement(elementId, patch, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function deleteElementForRestaurant(restaurantId: string, elementId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await deleteLayoutElement(elementId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/tables`)
  return res
}

export async function saveRestaurantCanvasDimensions(
  restaurantId: string,
  width: number,
  height: number,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { status: 'error' as const, errors: ['Invalid dimensions'] }
  }
  if (width < 5 || height < 5 || width > 500 || height > 500) {
    return { status: 'error' as const, errors: ['Dimensions out of range'] }
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { layoutWidth: width, layoutHeight: height },
  })
  revalidatePath(`/restaurants/${restaurantId}/tables`)
  return { status: 'ok' as const }
}
