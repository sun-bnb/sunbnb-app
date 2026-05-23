import prisma from '@repo/data/PrismaCient'
import { generateTableGrid, TABLE_SHAPE_DEFAULTS, type TableShape } from '@repo/schematic/grid'
import type { ActionResult, TableInput } from '../types'
import { requireRestaurantOwner } from '../ownership'
import { getTableById, type TableRecord } from './queries'

const ALLOWED_SHAPES: readonly TableShape[] = [
  'square',
  'round',
  'rect',
  'oval',
  'booth',
  'bar',
]
const ALLOWED_STATUSES = ['active', 'inactive'] as const
const ALLOWED_TABLE_FEATURES = [
  'accessible',
  'window',
  'outdoor',
  'high_top',
  'communal',
  'quiet',
] as const

function validateTableInput(input: Partial<TableInput>): string[] {
  const errors: string[] = []
  if (input.number !== undefined) {
    if (!Number.isInteger(input.number) || input.number < 1 || input.number > 9999) {
      errors.push('Table number must be 1–9999')
    }
  }
  if (input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50) {
      errors.push('Capacity must be 1–50')
    }
  }
  if (input.minPartySize !== undefined) {
    if (!Number.isInteger(input.minPartySize) || input.minPartySize < 1) {
      errors.push('Min party size must be ≥ 1')
    }
    if (
      input.capacity !== undefined &&
      input.minPartySize !== undefined &&
      input.minPartySize > input.capacity
    ) {
      errors.push('Min party size cannot exceed capacity')
    }
  }
  if (input.maxPartySize !== undefined && input.maxPartySize !== null) {
    if (!Number.isInteger(input.maxPartySize) || input.maxPartySize < 1) {
      errors.push('Max party size must be ≥ 1')
    }
    if (
      input.capacity !== undefined &&
      input.maxPartySize !== undefined &&
      input.maxPartySize !== null &&
      input.maxPartySize > input.capacity
    ) {
      errors.push('Max party size cannot exceed capacity')
    }
    if (
      input.minPartySize !== undefined &&
      input.maxPartySize !== undefined &&
      input.maxPartySize !== null &&
      input.maxPartySize < input.minPartySize
    ) {
      errors.push('Max party size cannot be less than min party size')
    }
  }
  if (
    input.turnTimeMinutes !== undefined && input.turnTimeMinutes !== null &&
    (!Number.isInteger(input.turnTimeMinutes) || input.turnTimeMinutes < 15 || input.turnTimeMinutes > 600)
  ) {
    errors.push('Turn time must be 15–600 minutes')
  }
  // Per-side seat counts must each be a non-negative integer when set.
  for (const side of ['seatsTop', 'seatsRight', 'seatsBottom', 'seatsLeft'] as const) {
    const v = input[side]
    if (v !== undefined && v !== null) {
      if (!Number.isInteger(v) || v < 0 || v > 50) {
        errors.push(`${side} must be 0–50`)
      }
    }
  }
  if (input.shape !== undefined && !ALLOWED_SHAPES.includes(input.shape)) {
    errors.push('Invalid shape')
  }
  if (input.label !== undefined && input.label !== null && input.label.length > 50) {
    errors.push('Label is too long (max 50)')
  }
  if (
    input.schematicX !== undefined && input.schematicX !== null &&
    (!Number.isFinite(input.schematicX) || input.schematicX < -10000 || input.schematicX > 10000)
  ) {
    errors.push('Invalid schematicX')
  }
  if (
    input.schematicY !== undefined && input.schematicY !== null &&
    (!Number.isFinite(input.schematicY) || input.schematicY < -10000 || input.schematicY > 10000)
  ) {
    errors.push('Invalid schematicY')
  }
  if (
    input.rotation !== undefined &&
    (!Number.isFinite(input.rotation) || input.rotation < -360 || input.rotation > 360)
  ) {
    errors.push('Rotation must be -360..360')
  }
  if (
    input.width !== undefined &&
    (!Number.isFinite(input.width) || input.width <= 0 || input.width > 50)
  ) {
    errors.push('Width must be 0.1–50 m')
  }
  if (
    input.height !== undefined &&
    (!Number.isFinite(input.height) || input.height <= 0 || input.height > 50)
  ) {
    errors.push('Height must be 0.1–50 m')
  }
  if (input.status !== undefined && !ALLOWED_STATUSES.includes(input.status)) {
    errors.push('Invalid status')
  }
  if (input.zone !== undefined && input.zone !== null && input.zone.length > 50) {
    errors.push('Zone is too long (max 50)')
  }
  if (input.staffNote !== undefined && input.staffNote !== null && input.staffNote.length > 500) {
    errors.push('Staff note is too long (max 500)')
  }
  if (input.features !== undefined) {
    if (!Array.isArray(input.features)) {
      errors.push('Features must be a list')
    } else if (input.features.some((f) => !ALLOWED_TABLE_FEATURES.includes(f as never))) {
      errors.push('Invalid table feature')
    }
  }
  if (
    input.depositPerGuest !== undefined && input.depositPerGuest !== null &&
    (!Number.isFinite(input.depositPerGuest) || input.depositPerGuest < 0 || input.depositPerGuest > 1000)
  ) {
    errors.push('Deposit per guest must be 0–1000')
  }
  return errors
}

async function nextTableNumber(restaurantId: string): Promise<number> {
  const max = await prisma.table.findFirst({
    where: { restaurantId },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  return (max?.number ?? 0) + 1
}

/** Create a single table at the given position. Ownership-checked. */
export async function createTable(
  restaurantId: string,
  input: Partial<TableInput> & { capacity: number; shape: TableShape },
  userId: string | null | undefined,
): Promise<ActionResult & { table?: TableRecord }> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateTableInput(input)
  if (errors.length > 0) return { status: 'error', errors }

  const number = input.number ?? (await nextTableNumber(restaurantId))
  const clash = await prisma.table.findUnique({
    where: { restaurantId_number: { restaurantId, number } },
    select: { id: true },
  })
  if (clash) return { status: 'error', errors: ['Table number already in use'] }

  const defaultSize = TABLE_SHAPE_DEFAULTS[input.shape] ?? TABLE_SHAPE_DEFAULTS.square
  const created = await prisma.table.create({
    data: {
      restaurantId,
      number,
      label: input.label ?? null,
      capacity: input.capacity,
      minPartySize: input.minPartySize ?? 1,
      maxPartySize: input.maxPartySize ?? null,
      shape: input.shape,
      width: input.width ?? defaultSize.width,
      height: input.height ?? defaultSize.height,
      schematicX: input.schematicX ?? null,
      schematicY: input.schematicY ?? null,
      rotation: input.rotation ?? 0,
      status: input.status ?? 'active',
      zone: input.zone ?? null,
      staffNote: input.staffNote ?? null,
      onlineBookable: input.onlineBookable ?? true,
      combinable: input.combinable ?? false,
      features: input.features ?? [],
      requiresDeposit: input.requiresDeposit ?? null,
      depositPerGuest: input.depositPerGuest ?? null,
      turnTimeMinutes: input.turnTimeMinutes ?? null,
      locked: input.locked ?? false,
      seatsTop: input.seatsTop ?? null,
      seatsRight: input.seatsRight ?? null,
      seatsBottom: input.seatsBottom ?? null,
      seatsLeft: input.seatsLeft ?? null,
    },
    select: { id: true },
  })
  const table = await getTableById(created.id)
  return { status: 'ok', ...(table ? { table } : {}) }
}

/** Update selected fields on a table. Ownership-checked via its restaurant. */
export async function updateTable(
  tableId: string,
  patch: Partial<TableInput>,
  userId: string | null | undefined,
): Promise<ActionResult & { table?: TableRecord }> {
  const existing = await prisma.table.findUnique({
    where: { id: tableId },
    select: { id: true, restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateTableInput(patch)
  if (errors.length > 0) return { status: 'error', errors }

  // Handle number collisions explicitly (the DB has a unique composite).
  if (patch.number !== undefined) {
    const clash = await prisma.table.findUnique({
      where: { restaurantId_number: { restaurantId: existing.restaurantId, number: patch.number } },
      select: { id: true },
    })
    if (clash && clash.id !== tableId) {
      return { status: 'error', errors: ['Table number already in use'] }
    }
  }

  const data: Record<string, unknown> = {}
  if (patch.number !== undefined) data.number = patch.number
  if (patch.label !== undefined) data.label = patch.label
  if (patch.capacity !== undefined) data.capacity = patch.capacity
  if (patch.minPartySize !== undefined) data.minPartySize = patch.minPartySize
  if (patch.maxPartySize !== undefined) data.maxPartySize = patch.maxPartySize
  if (patch.shape !== undefined) data.shape = patch.shape
  if (patch.width !== undefined) data.width = patch.width
  if (patch.height !== undefined) data.height = patch.height
  if (patch.schematicX !== undefined) data.schematicX = patch.schematicX
  if (patch.schematicY !== undefined) data.schematicY = patch.schematicY
  if (patch.rotation !== undefined) data.rotation = patch.rotation
  if (patch.status !== undefined) data.status = patch.status
  if (patch.zone !== undefined) data.zone = patch.zone
  if (patch.staffNote !== undefined) data.staffNote = patch.staffNote
  if (patch.onlineBookable !== undefined) data.onlineBookable = patch.onlineBookable
  if (patch.combinable !== undefined) data.combinable = patch.combinable
  if (patch.features !== undefined) data.features = patch.features
  if (patch.requiresDeposit !== undefined) data.requiresDeposit = patch.requiresDeposit
  if (patch.depositPerGuest !== undefined) data.depositPerGuest = patch.depositPerGuest
  if (patch.turnTimeMinutes !== undefined) data.turnTimeMinutes = patch.turnTimeMinutes
  if (patch.locked !== undefined) data.locked = patch.locked
  if (patch.seatsTop !== undefined) data.seatsTop = patch.seatsTop
  if (patch.seatsRight !== undefined) data.seatsRight = patch.seatsRight
  if (patch.seatsBottom !== undefined) data.seatsBottom = patch.seatsBottom
  if (patch.seatsLeft !== undefined) data.seatsLeft = patch.seatsLeft

  await prisma.table.update({ where: { id: tableId }, data })
  const table = await getTableById(tableId)
  return { status: 'ok', ...(table ? { table } : {}) }
}

/**
 * Duplicate an existing table at an offset position. Clones every property
 * except id / number / position; the new table gets the next available
 * number and is offset by `dx, dy` in metres so it doesn't sit on top of the
 * source. Ownership-checked via its restaurant.
 */
export async function duplicateTable(
  tableId: string,
  userId: string | null | undefined,
  options: { dx?: number; dy?: number } = {},
): Promise<ActionResult & { table?: TableRecord }> {
  const source = await prisma.table.findUnique({
    where: { id: tableId },
    select: {
      restaurantId: true,
      label: true,
      capacity: true,
      minPartySize: true,
      maxPartySize: true,
      shape: true,
      width: true,
      height: true,
      schematicX: true,
      schematicY: true,
      rotation: true,
      status: true,
      zone: true,
      staffNote: true,
      onlineBookable: true,
      combinable: true,
      features: true,
      requiresDeposit: true,
      depositPerGuest: true,
      turnTimeMinutes: true,
      locked: true,
      seatsTop: true,
      seatsRight: true,
      seatsBottom: true,
      seatsLeft: true,
    },
  })
  if (!source) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(source.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const number = await nextTableNumber(source.restaurantId)
  const dx = options.dx ?? source.width + 0.5
  const dy = options.dy ?? 0
  const created = await prisma.table.create({
    data: {
      restaurantId: source.restaurantId,
      number,
      label: source.label,
      capacity: source.capacity,
      minPartySize: source.minPartySize,
      maxPartySize: source.maxPartySize,
      shape: source.shape,
      width: source.width,
      height: source.height,
      schematicX: source.schematicX !== null ? source.schematicX + dx : null,
      schematicY: source.schematicY !== null ? source.schematicY + dy : null,
      rotation: source.rotation,
      status: source.status,
      zone: source.zone,
      staffNote: source.staffNote,
      onlineBookable: source.onlineBookable,
      combinable: source.combinable,
      features: source.features,
      requiresDeposit: source.requiresDeposit,
      depositPerGuest: source.depositPerGuest,
      turnTimeMinutes: source.turnTimeMinutes,
      // Don't carry the `locked` flag — the freshly placed copy should be
      // immediately movable.
      locked: false,
      seatsTop: source.seatsTop,
      seatsRight: source.seatsRight,
      seatsBottom: source.seatsBottom,
      seatsLeft: source.seatsLeft,
    },
    select: { id: true },
  })
  const table = await getTableById(created.id)
  return { status: 'ok', ...(table ? { table } : {}) }
}

/** Delete a table. Ownership-checked via its restaurant. */
export async function deleteTable(
  tableId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const existing = await prisma.table.findUnique({
    where: { id: tableId },
    select: { restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.table.delete({ where: { id: tableId } })
  return { status: 'ok' }
}

export interface TableGridPlacementInput {
  rows: number
  cols: number
  originX: number
  originY: number
  horizontalGap: number
  verticalGap: number
  tableWidth: number
  tableHeight: number
  capacity: number
  shape: TableShape
  rotation: number
}

/**
 * Place a rectangular grid of tables starting at (originX, originY). Uses
 * the pure geometry helper in @repo/schematic; numbers continue from the
 * current highest table number in the restaurant.
 */
export async function createTableGrid(
  restaurantId: string,
  input: TableGridPlacementInput,
  userId: string | null | undefined,
): Promise<ActionResult & { created?: number }> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  if (!Number.isInteger(input.rows) || input.rows < 1 || input.rows > 50) {
    return { status: 'error', errors: ['rows must be 1–50'] }
  }
  if (!Number.isInteger(input.cols) || input.cols < 1 || input.cols > 50) {
    return { status: 'error', errors: ['cols must be 1–50'] }
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50) {
    return { status: 'error', errors: ['capacity must be 1–50'] }
  }
  if (!ALLOWED_SHAPES.includes(input.shape)) {
    return { status: 'error', errors: ['Invalid shape'] }
  }

  const cells = generateTableGrid({
    rows: input.rows,
    tablesPerRow: input.cols,
    horizontalGap: input.horizontalGap,
    verticalGap: input.verticalGap,
    tableWidth: input.tableWidth,
    tableHeight: input.tableHeight,
    capacity: input.capacity,
    shape: input.shape,
    rotation: input.rotation,
  })

  if (cells.length === 0) return { status: 'ok', created: 0 }

  const baseNumber = await nextTableNumber(restaurantId)
  const data = cells.map((cell, idx) => ({
    restaurantId,
    number: baseNumber + idx,
    capacity: input.capacity,
    minPartySize: 1,
    shape: input.shape,
    width: input.tableWidth,
    height: input.tableHeight,
    schematicX: input.originX + cell.dx,
    schematicY: input.originY + cell.dy,
    rotation: input.rotation,
  }))

  await prisma.table.createMany({ data })
  return { status: 'ok', created: data.length }
}

export { ALLOWED_SHAPES, ALLOWED_STATUSES, ALLOWED_TABLE_FEATURES, TABLE_SHAPE_DEFAULTS }
