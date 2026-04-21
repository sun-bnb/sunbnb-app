'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

const ALLOWED_SHAPES = ['rect', 'ellipse', 'icon'] as const
type Shape = (typeof ALLOWED_SHAPES)[number]

interface CreateLayoutElementInput {
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

function validateGeometry(input: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) {
  const { x, y, width, height, rotation } = input
  if (x !== undefined && (!Number.isFinite(x) || x < -10000 || x > 10000)) return 'Invalid x'
  if (y !== undefined && (!Number.isFinite(y) || y < -10000 || y > 10000)) return 'Invalid y'
  if (width !== undefined && (!Number.isFinite(width) || width <= 0 || width > 10000)) return 'Invalid width'
  if (height !== undefined && (!Number.isFinite(height) || height <= 0 || height > 10000)) return 'Invalid height'
  if (rotation !== undefined && (!Number.isFinite(rotation) || rotation < -360 || rotation > 360)) return 'Invalid rotation'
  return null
}

export async function createLayoutElement(siteId: string, data: CreateLayoutElementInput) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (!data.type || typeof data.type !== 'string' || data.type.length > 50) {
    return { status: 'error', errors: ['Invalid type'] }
  }
  if (!ALLOWED_SHAPES.includes(data.shape)) {
    return { status: 'error', errors: ['Invalid shape'] }
  }
  const geomErr = validateGeometry(data)
  if (geomErr) return { status: 'error', errors: [geomErr] }
  if (data.label && data.label.length > 100) {
    return { status: 'error', errors: ['Label too long'] }
  }

  const element = await prisma.layoutElement.create({
    data: {
      siteId,
      type: data.type,
      shape: data.shape,
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
      rotation: data.rotation ?? 0,
      z: data.z ?? 100,
      label: data.label ?? null,
      color: data.color ?? null,
      cornerRadius: data.cornerRadius ?? 0,
    },
  })

  revalidatePath(`/sites/${siteId}/schematic`)
  return { status: 'ok', element }
}

interface UpdateLayoutElementInput {
  type?: string
  shape?: Shape
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  z?: number
  label?: string | null
  color?: string | null
  cornerRadius?: number | null
}

export async function updateLayoutElement(id: string, patch: UpdateLayoutElementInput) {
  const existing = await prisma.layoutElement.findUnique({
    where: { id },
    select: { siteId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireSiteOwner(existing.siteId)
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

  await prisma.layoutElement.update({
    where: { id },
    data: patch,
  })

  revalidatePath(`/sites/${existing.siteId}/schematic`)
  return { status: 'ok' }
}

export async function deleteLayoutElement(id: string) {
  const existing = await prisma.layoutElement.findUnique({
    where: { id },
    select: { siteId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireSiteOwner(existing.siteId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.layoutElement.delete({ where: { id } })

  revalidatePath(`/sites/${existing.siteId}/schematic`)
  return { status: 'ok' }
}

export async function reorderLayoutElements(
  siteId: string,
  order: { id: string; z: number }[],
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (!Array.isArray(order) || order.length === 0) return { status: 'ok' }
  if (order.some((o) => !o.id || !Number.isInteger(o.z))) {
    return { status: 'error', errors: ['Invalid order entries'] }
  }

  const ids = order.map((o) => o.id)
  const owned = await prisma.layoutElement.findMany({
    where: { id: { in: ids }, siteId },
    select: { id: true },
  })
  if (owned.length !== ids.length) {
    return { status: 'error', errors: ['Some elements do not belong to this site'] }
  }

  await prisma.$transaction(
    order.map((o) =>
      prisma.layoutElement.update({ where: { id: o.id }, data: { z: o.z } }),
    ),
  )

  revalidatePath(`/sites/${siteId}/schematic`)
  return { status: 'ok' }
}
