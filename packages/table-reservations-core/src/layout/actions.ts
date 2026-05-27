import prisma from '@repo/data/PrismaCient'
import type { ActionResult } from '../types'
import { requireRestaurantOwner } from '../ownership'

const ALLOWED_SHAPES = ['rect', 'ellipse', 'icon'] as const
type Shape = (typeof ALLOWED_SHAPES)[number]

export interface LayoutElementInput {
  type: string
  shape: Shape
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  z?: number
  label?: string | null
  color?: string | null
  cornerRadius?: number | null
}

export interface LayoutElementRecord {
  id: string
  restaurantId: string | null
  siteId: string | null
  type: string
  shape: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z: number
  label: string | null
  color: string | null
  cornerRadius: number | null
}

const layoutSelect = {
  id: true,
  restaurantId: true,
  siteId: true,
  type: true,
  shape: true,
  x: true,
  y: true,
  width: true,
  height: true,
  rotation: true,
  z: true,
  label: true,
  color: true,
  cornerRadius: true,
} as const

function validateGeometry(input: Partial<LayoutElementInput>): string | null {
  const { x, y, width, height, rotation, cornerRadius } = input
  if (x !== undefined && (!Number.isFinite(x) || x < -10000 || x > 10000)) return 'Invalid x'
  if (y !== undefined && (!Number.isFinite(y) || y < -10000 || y > 10000)) return 'Invalid y'
  if (width !== undefined && (!Number.isFinite(width) || width <= 0 || width > 10000)) return 'Invalid width'
  if (height !== undefined && (!Number.isFinite(height) || height <= 0 || height > 10000)) return 'Invalid height'
  if (rotation !== undefined && (!Number.isFinite(rotation) || rotation < -360 || rotation > 360)) return 'Invalid rotation'
  if (
    cornerRadius !== undefined && cornerRadius !== null &&
    (!Number.isFinite(cornerRadius) || cornerRadius < 0 || cornerRadius > 1000)
  ) return 'Invalid cornerRadius'
  return null
}

export async function listLayoutElementsForRestaurant(
  restaurantId: string,
): Promise<LayoutElementRecord[]> {
  return prisma.layoutElement.findMany({
    where: { restaurantId },
    orderBy: { z: 'asc' },
    select: layoutSelect,
  })
}

/** A floor-map table sanitized for the public ("pick your spot") consumer view —
 *  geometry + render hints only. Deliberately omits staff notes, deposit amounts,
 *  party-size rules, and other partner-internal fields. */
export interface PublicLayoutTable {
  id: string
  label: string | null
  capacity: number
  shape: string
  width: number
  height: number
  schematicX: number | null
  schematicY: number | null
  rotation: number
  zone: string | null
  guestSelectable: boolean
  seatsTop: number | null
  seatsRight: number | null
  seatsBottom: number | null
  seatsLeft: number | null
}

export interface PublicRestaurantLayout {
  restaurantId: string
  guestSelectionEnabled: boolean
  world: { width: number; height: number }
  elements: LayoutElementRecord[]
  tables: PublicLayoutTable[]
}

/**
 * Public, sanitized floor layout for the consumer "pick your spot" map. No
 * ownership check (it's public) but returns only render geometry — never staff
 * notes or deposit amounts. Returns null when the restaurant doesn't exist.
 * Only `active` tables are returned (inactive tables aren't bookable and
 * shouldn't clutter the floor).
 */
export async function getPublicRestaurantLayout(
  restaurantId: string,
): Promise<PublicRestaurantLayout | null> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, layoutWidth: true, layoutHeight: true, guestSelectionEnabled: true },
  })
  if (!restaurant) return null

  const [tables, elements] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId, status: 'active' },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        label: true,
        capacity: true,
        shape: true,
        width: true,
        height: true,
        schematicX: true,
        schematicY: true,
        rotation: true,
        zone: true,
        guestSelectable: true,
        seatsTop: true,
        seatsRight: true,
        seatsBottom: true,
        seatsLeft: true,
      },
    }),
    listLayoutElementsForRestaurant(restaurantId),
  ])

  return {
    restaurantId: restaurant.id,
    guestSelectionEnabled: restaurant.guestSelectionEnabled,
    world: { width: restaurant.layoutWidth ?? 15, height: restaurant.layoutHeight ?? 10 },
    elements,
    tables,
  }
}

export async function createLayoutElement(
  restaurantId: string,
  input: LayoutElementInput,
  userId: string | null | undefined,
): Promise<ActionResult & { element?: LayoutElementRecord }> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  if (!input.type || typeof input.type !== 'string' || input.type.length > 50) {
    return { status: 'error', errors: ['Invalid type'] }
  }
  if (!ALLOWED_SHAPES.includes(input.shape)) {
    return { status: 'error', errors: ['Invalid shape'] }
  }
  const geomErr = validateGeometry(input)
  if (geomErr) return { status: 'error', errors: [geomErr] }
  if (input.label && input.label.length > 100) {
    return { status: 'error', errors: ['Label too long'] }
  }

  const created = await prisma.layoutElement.create({
    data: {
      restaurantId,
      siteId: null,
      type: input.type,
      shape: input.shape,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      rotation: input.rotation ?? 0,
      z: input.z ?? 100,
      label: input.label ?? null,
      color: input.color ?? null,
      cornerRadius: input.cornerRadius ?? 0,
    },
    select: layoutSelect,
  })
  return { status: 'ok', element: created }
}

export async function updateLayoutElement(
  id: string,
  patch: Partial<LayoutElementInput>,
  userId: string | null | undefined,
): Promise<ActionResult & { element?: LayoutElementRecord }> {
  const existing = await prisma.layoutElement.findUnique({
    where: { id },
    select: { restaurantId: true },
  })
  if (!existing || !existing.restaurantId) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  if (patch.shape !== undefined && !ALLOWED_SHAPES.includes(patch.shape)) {
    return { status: 'error', errors: ['Invalid shape'] }
  }
  if (patch.type !== undefined && (typeof patch.type !== 'string' || patch.type.length > 50)) {
    return { status: 'error', errors: ['Invalid type'] }
  }
  const geomErr = validateGeometry(patch)
  if (geomErr) return { status: 'error', errors: [geomErr] }
  if (patch.label && patch.label.length > 100) {
    return { status: 'error', errors: ['Label too long'] }
  }

  const updated = await prisma.layoutElement.update({
    where: { id },
    data: patch,
    select: layoutSelect,
  })
  return { status: 'ok', element: updated }
}

export async function deleteLayoutElement(
  id: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const existing = await prisma.layoutElement.findUnique({
    where: { id },
    select: { restaurantId: true },
  })
  if (!existing || !existing.restaurantId) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.layoutElement.delete({ where: { id } })
  return { status: 'ok' }
}
