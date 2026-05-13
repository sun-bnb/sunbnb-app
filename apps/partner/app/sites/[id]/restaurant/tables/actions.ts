'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteOwnerWithFlag } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import {
  createTable,
  createTableGrid,
  duplicateTable,
  updateTable,
  deleteTable,
  createLayoutElement,
  updateLayoutElement,
  deleteLayoutElement,
  type TableInput,
  type TableGridPlacementInput,
  type LayoutElementInput,
} from '@repo/table-reservations-core'

type LinkedOk = { ok: true; restaurantId: string; userId: string }
type LinkedErr = { ok: false; error: string }

/**
 * Resolve the Restaurant linked to a Sunbnb site, enforcing site ownership
 * first. Discriminated union on `ok` so the narrowing is unambiguous.
 */
async function requireLinkedRestaurant(
  siteId: string,
): Promise<LinkedOk | LinkedErr> {
  const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
  if (error) return { ok: false, error }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) {
    return { ok: false, error: 'Site has no linked restaurant' }
  }
  return {
    ok: true,
    restaurantId: site.restaurantId,
    userId: session!.user.id as string,
  }
}

export async function createTableForSite(
  siteId: string,
  at: { x: number; y: number },
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { restaurantId, userId } = r

  const res = await createTable(
    restaurantId,
    { capacity: 4, shape: 'square', schematicX: at.x, schematicY: at.y },
    userId,
  )
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function updateTableForSite(
  siteId: string,
  tableId: string,
  patch: Partial<TableInput>,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { userId } = r

  const res = await updateTable(tableId, patch, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function duplicateTableForSite(
  siteId: string,
  tableId: string,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const { userId } = r

  const res = await duplicateTable(tableId, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return {
    status: res.status,
    errors: res.errors,
    tableId: res.table?.id,
  }
}

export async function deleteTableForSite(siteId: string, tableId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { userId } = r

  const res = await deleteTable(tableId, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function createTableGridForSite(
  siteId: string,
  input: TableGridPlacementInput,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { restaurantId, userId } = r

  const res = await createTableGrid(restaurantId, input, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function createElementForSite(
  siteId: string,
  input: LayoutElementInput,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { restaurantId, userId } = r

  const res = await createLayoutElement(restaurantId, input, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function updateElementForSite(
  siteId: string,
  elementId: string,
  patch: Partial<LayoutElementInput>,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { userId } = r

  const res = await updateLayoutElement(elementId, patch, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function deleteElementForSite(siteId: string, elementId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: "error" as const, errors: [r.error] }
  const { userId } = r

  const res = await deleteLayoutElement(elementId, userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return res
}

export async function saveRestaurantDimensions(
  siteId: string,
  width: number,
  height: number,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const { restaurantId } = r

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
  revalidatePath(`/sites/${siteId}/restaurant/tables`)
  return { status: 'ok' as const }
}
