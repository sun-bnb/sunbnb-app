import prisma from '@repo/data/PrismaCient'
import type { ActionResult, MenuItemInput } from '../types'
import { requireRestaurantOwner } from '../ownership'
import { getMenuItemById, type MenuItemRecord } from './queries'

function validateMenuItemInput(input: Partial<MenuItemInput>): string[] {
  const errors: string[] = []
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      errors.push('Name is required')
    } else if (input.name.length > 120) {
      errors.push('Name is too long (max 120)')
    }
  }
  if (input.description !== undefined && input.description !== null && input.description.length > 500) {
    errors.push('Description is too long (max 500)')
  }
  if (input.price !== undefined) {
    if (!Number.isFinite(input.price) || input.price < 0 || input.price > 100000) {
      errors.push('Price must be 0–100,000')
    }
  }
  if (input.category !== undefined && input.category.length > 50) {
    errors.push('Category is too long (max 50)')
  }
  if (
    input.imageUrl !== undefined && input.imageUrl !== null &&
    (typeof input.imageUrl !== 'string' || input.imageUrl.length > 2048)
  ) {
    errors.push('Invalid imageUrl')
  }
  if (
    input.displayOrder !== undefined &&
    (!Number.isInteger(input.displayOrder) || input.displayOrder < 0 || input.displayOrder > 99999)
  ) {
    errors.push('Invalid displayOrder')
  }
  return errors
}

async function nextDisplayOrder(restaurantId: string): Promise<number> {
  const last = await prisma.menuItem.findFirst({
    where: { restaurantId },
    orderBy: { displayOrder: 'desc' },
    select: { displayOrder: true },
  })
  return (last?.displayOrder ?? -1) + 1
}

export async function createMenuItem(
  restaurantId: string,
  input: MenuItemInput,
  userId: string | null | undefined,
): Promise<ActionResult & { item?: MenuItemRecord }> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  // `price` is required; others validated as given.
  if (input.price === undefined) {
    return { status: 'error', errors: ['Price is required'] }
  }
  const errors = validateMenuItemInput(input)
  if (errors.length > 0) return { status: 'error', errors }

  const created = await prisma.menuItem.create({
    data: {
      restaurantId,
      name: input.name.trim(),
      description: input.description ?? null,
      price: input.price,
      imageUrl: input.imageUrl ?? null,
      category: input.category ?? 'main',
      displayOrder: input.displayOrder ?? (await nextDisplayOrder(restaurantId)),
    },
    select: { id: true },
  })
  const item = await getMenuItemById(created.id)
  return { status: 'ok', ...(item ? { item } : {}) }
}

export async function updateMenuItem(
  menuItemId: string,
  patch: Partial<MenuItemInput>,
  userId: string | null | undefined,
): Promise<ActionResult & { item?: MenuItemRecord }> {
  const existing = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { id: true, restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateMenuItemInput(patch)
  if (errors.length > 0) return { status: 'error', errors }

  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name.trim()
  if (patch.description !== undefined) data.description = patch.description
  if (patch.price !== undefined) data.price = patch.price
  if (patch.imageUrl !== undefined) data.imageUrl = patch.imageUrl
  if (patch.category !== undefined) data.category = patch.category
  if (patch.displayOrder !== undefined) data.displayOrder = patch.displayOrder

  await prisma.menuItem.update({ where: { id: menuItemId }, data })
  const item = await getMenuItemById(menuItemId)
  return { status: 'ok', ...(item ? { item } : {}) }
}

/** Quick toggle — kept separate so the UI can hit a narrow endpoint. */
export async function setMenuItemSoldOut(
  menuItemId: string,
  soldOut: boolean,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const existing = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.menuItem.update({ where: { id: menuItemId }, data: { soldOut } })
  return { status: 'ok' }
}

/**
 * Soft-delete: keep the row for historical order references; mark inactive
 * so it disappears from customer menus and the default partner listing.
 */
export async function archiveMenuItem(
  menuItemId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const existing = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.menuItem.update({ where: { id: menuItemId }, data: { active: false } })
  return { status: 'ok' }
}

export async function restoreMenuItem(
  menuItemId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const existing = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.menuItem.update({ where: { id: menuItemId }, data: { active: true } })
  return { status: 'ok' }
}

/**
 * Bulk-reorder. `orderedIds` is the full set of item ids in the new order;
 * each gets a displayOrder matching its position. All must belong to the
 * same restaurant (enforced by ownership check + a set-membership guard).
 */
export async function reorderMenuItems(
  restaurantId: string,
  orderedIds: string[],
  userId: string | null | undefined,
): Promise<ActionResult> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { status: 'ok' }
  }

  const items = await prisma.menuItem.findMany({
    where: { id: { in: orderedIds } },
    select: { id: true, restaurantId: true },
  })
  const wrongRestaurant = items.find((i) => i.restaurantId !== restaurantId)
  if (wrongRestaurant || items.length !== orderedIds.length) {
    return { status: 'error', errors: ['Items must belong to this restaurant'] }
  }

  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.menuItem.update({ where: { id }, data: { displayOrder: idx } }),
    ),
  )
  return { status: 'ok' }
}
