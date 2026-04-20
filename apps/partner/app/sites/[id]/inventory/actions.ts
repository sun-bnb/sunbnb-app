'use server'

import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidItemStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'

import { generateChairs, generateChairsSchematic, ChairConfig } from './chair-util'

type Mode = 'create' | 'rearrange'

async function getSiteLayoutMode(siteId: string): Promise<'geo' | 'schematic'> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { layoutMode: true },
  })
  return site?.layoutMode === 'schematic' ? 'schematic' : 'geo'
}

export async function syncChairsWithLayout(siteId: string, config: ChairConfig, mode: Mode) {

  const { session, error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const layoutMode = await getSiteLayoutMode(siteId)
  const isSchematic = layoutMode === 'schematic'

  const generated = isSchematic
    ? generateChairsSchematic({
        ...config,
        baseX: config.baseLng,
        baseY: config.baseLat,
      }).map((c) => ({
        tempId: c.tempId,
        pairTempId: c.pairTempId,
        locationLat: '0',
        locationLng: '0',
        schematicX: c.schematicX,
        schematicY: c.schematicY,
        rotation: c.rotation,
        group: c.group,
        number: c.number,
        isPrimary: c.isPrimary,
      }))
    : generateChairs(config).map((c) => ({ ...c, schematicX: undefined, schematicY: undefined }))

  const group = config.group

  const itemGroupData = isSchematic
    ? {
        number: config.group,
        price: config.price,
        category: config.category,
        rows: config.rows,
        seatsPerRow: config.seatsPerRow,
        horizontalGap: config.horizontalGap,
        verticalGap: config.verticalGap,
        pairGap: config.intraPairGap,
        rotation: config.rotation,
        locationLat: '0',
        locationLng: '0',
        schematicX: config.baseLng,
        schematicY: config.baseLat,
      }
    : {
        number: config.group,
        price: config.price,
        category: config.category,
        rows: config.rows,
        seatsPerRow: config.seatsPerRow,
        horizontalGap: config.horizontalGap,
        verticalGap: config.verticalGap,
        pairGap: config.intraPairGap,
        rotation: config.rotation,
        locationLat: String(config.baseLat),
        locationLng: String(config.baseLng)
      }

  if (mode === 'create') {

    const itemGroup = await prisma.itemGroup.create({
      data: itemGroupData
    })

    await Promise.all(
      generated.map((item) =>
        prisma.inventoryItem.create({
          data: {
            userId: session?.user?.id,
            itemGroupId: itemGroup.id,
            siteId,
            status: 'active',
            locationLat: item.locationLat,
            locationLng: item.locationLng,
            ...(isSchematic ? { schematicX: item.schematicX, schematicY: item.schematicY } : {}),
            rotation: item.rotation,
            number: item.number,
            group: item.group,
            category: config.category,
            price: config.price,
            pairId: null
          }
        })
      )
    )
  }

  if (mode === 'rearrange') {

    const existing = await prisma.inventoryItem.findMany({
      where: { siteId, group },
      select: {
        id: true,
        number: true,
        itemGroupId: true,
        locationLat: true,
        locationLng: true,
        schematicX: true,
        schematicY: true,
      }
    })

    // Preserve the visual centroid across the rearrange so rotation pivots
    // around the parcel center rather than the first seat.
    let shiftedGenerated = generated
    let shiftedGroupData = itemGroupData
    if (existing.length > 0 && generated.length > 0) {
      if (isSchematic) {
        const oldCx = existing.reduce((s, i) => s + (i.schematicX ?? 0), 0) / existing.length
        const oldCy = existing.reduce((s, i) => s + (i.schematicY ?? 0), 0) / existing.length
        const newCx = generated.reduce((s, g) => s + (g.schematicX ?? 0), 0) / generated.length
        const newCy = generated.reduce((s, g) => s + (g.schematicY ?? 0), 0) / generated.length
        const dx = oldCx - newCx
        const dy = oldCy - newCy
        shiftedGenerated = generated.map((g) => ({
          ...g,
          schematicX: (g.schematicX ?? 0) + dx,
          schematicY: (g.schematicY ?? 0) + dy,
        }))
        shiftedGroupData = {
          ...itemGroupData,
          schematicX: (itemGroupData.schematicX ?? 0) + dx,
          schematicY: (itemGroupData.schematicY ?? 0) + dy,
        }
      } else {
        const oldCLat = existing.reduce((s, i) => s + parseFloat(i.locationLat), 0) / existing.length
        const oldCLng = existing.reduce((s, i) => s + parseFloat(i.locationLng), 0) / existing.length
        const newCLat = generated.reduce((s, g) => s + parseFloat(g.locationLat), 0) / generated.length
        const newCLng = generated.reduce((s, g) => s + parseFloat(g.locationLng), 0) / generated.length
        const dLat = oldCLat - newCLat
        const dLng = oldCLng - newCLng
        shiftedGenerated = generated.map((g) => ({
          ...g,
          locationLat: (parseFloat(g.locationLat) + dLat).toString(),
          locationLng: (parseFloat(g.locationLng) + dLng).toString(),
        }))
        shiftedGroupData = {
          ...itemGroupData,
          locationLat: (parseFloat(itemGroupData.locationLat) + dLat).toString(),
          locationLng: (parseFloat(itemGroupData.locationLng) + dLng).toString(),
        }
      }
    }

    const numberToId = new Map(existing.map((e) => [e.number, e.id]))

    let itemGroup = null
    if (existing.length > 0 && !(existing[0]?.itemGroupId)) {
      itemGroup = await prisma.itemGroup.create({
        data: shiftedGroupData
      })
    } else {
      itemGroup = await prisma.itemGroup.update({
        where: { id: existing[0]!.itemGroupId! },
        data: shiftedGroupData
      })
    }

    // Track which existing items get matched to a generated position
    const matchedIds = new Set<string>()

    // Update existing chairs that match a generated position by number
    await Promise.all(
      shiftedGenerated.map((item) => {
        const id = numberToId.get(item.number)
        if (!id) return Promise.resolve()

        matchedIds.add(id)
        return prisma.inventoryItem.update({
          where: { id },
          data: {
            itemGroupId: itemGroup ? itemGroup.id : undefined,
            locationLat: item.locationLat,
            locationLng: item.locationLng,
            ...(isSchematic ? { schematicX: item.schematicX, schematicY: item.schematicY } : {}),
            rotation: item.rotation,
            number: item.number,
            group: item.group,
            category: config.category,
            price: config.price,
            pairId: null, // will be updated below
          },
        })
      })
    )

    // Assign remaining unmatched existing items to any leftover generated
    // positions so that every item in the group gets repositioned.
    const unmatchedExisting = existing.filter((e) => !matchedIds.has(e.id))
    const unmatchedGenerated = shiftedGenerated.filter((g) => !numberToId.has(g.number))

    await Promise.all(
      unmatchedExisting.map((existingItem, idx) => {
        const gen = unmatchedGenerated[idx]
        if (!gen) return Promise.resolve()

        matchedIds.add(existingItem.id)
        return prisma.inventoryItem.update({
          where: { id: existingItem.id },
          data: {
            itemGroupId: itemGroup ? itemGroup.id : undefined,
            locationLat: gen.locationLat,
            locationLng: gen.locationLng,
            ...(isSchematic ? { schematicX: gen.schematicX, schematicY: gen.schematicY } : {}),
            rotation: gen.rotation,
            number: gen.number,
            group: gen.group,
            category: config.category,
            price: config.price,
            pairId: null,
          },
        })
      })
    )
  }

  await assignChairPairings({ generated, group, siteId })

}


async function assignChairPairings({
  generated,
  group,
  siteId,
}: {
  generated: ReturnType<typeof generateChairs>
  group: number
  siteId: string
}) {
  const allItems = await prisma.inventoryItem.findMany({
    where: { siteId, group },
    select: { id: true, number: true },
  })

  const numberToId = new Map(allItems.map((i) => [i.number, i.id]))
  const tempToNumber = new Map(generated.map((i) => [i.tempId, i.number]))

  for (const item of generated) {
    if (!item.pairTempId || !item.isPrimary) continue

    const itemId = numberToId.get(item.number)
    const pairNumber = tempToNumber.get(item.pairTempId)
    const pairId = pairNumber ? numberToId.get(pairNumber) : undefined

    if (itemId && pairId) {
      await prisma.inventoryItem.update({
        where: { id: itemId },
        data: { pairId },
      })
    }
  }
}

export async function getItemGroup(id: string) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const group = await prisma.itemGroup.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { number: 'asc' },
        select: { site: { select: { userId: true } } }
      }
    }
  })
  if (!group || !group.items[0] || group.items[0].site.userId !== session.user.id) {
    throw new Error('Not authorized')
  }

  return await prisma.itemGroup.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { number: 'asc' }
      }
    }
  })
}

export async function moveParcel(
  siteId: string,
  group: number,
  deltaLat: number,
  deltaLng: number
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  const items = await prisma.inventoryItem.findMany({
    where: { siteId, group },
    select: {
      id: true,
      locationLat: true,
      locationLng: true,
      schematicX: true,
      schematicY: true,
      itemGroupId: true,
    },
  })

  await Promise.all(
    items.map((item) =>
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: isSchematic
          ? {
              schematicX: (item.schematicX ?? 0) + deltaLng,
              schematicY: (item.schematicY ?? 0) + deltaLat,
            }
          : {
              locationLat: String(parseFloat(item.locationLat) + deltaLat),
              locationLng: String(parseFloat(item.locationLng) + deltaLng),
            },
      })
    )
  )

  // Also update the ItemGroup's stored anchor point
  const itemGroupId = items[0]?.itemGroupId
  if (itemGroupId) {
    const ig = await prisma.itemGroup.findUnique({ where: { id: itemGroupId } })
    if (ig) {
      await prisma.itemGroup.update({
        where: { id: itemGroupId },
        data: isSchematic
          ? {
              schematicX: (ig.schematicX ?? 0) + deltaLng,
              schematicY: (ig.schematicY ?? 0) + deltaLat,
            }
          : {
              locationLat: String(parseFloat(ig.locationLat) + deltaLat),
              locationLng: String(parseFloat(ig.locationLng) + deltaLng),
            },
      })
    }
  }

  return { status: 'ok' }
}

export async function moveItems(
  siteId: string,
  itemIds: string[],
  deltaLat: number,
  deltaLng: number
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (itemIds.length === 0) return { status: 'ok' }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: {
      id: true,
      locationLat: true,
      locationLng: true,
      schematicX: true,
      schematicY: true,
    },
  })

  await Promise.all(
    items.map((item) =>
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: isSchematic
          ? {
              schematicX: (item.schematicX ?? 0) + deltaLng,
              schematicY: (item.schematicY ?? 0) + deltaLat,
            }
          : {
              locationLat: String(parseFloat(item.locationLat) + deltaLat),
              locationLng: String(parseFloat(item.locationLng) + deltaLng),
            },
      })
    )
  )

  // If all moved items belong to the same group, update the ItemGroup anchor too
  const fullItems = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { group: true, itemGroupId: true },
  })
  const groups = new Set(fullItems.map(i => i.group))
  const itemGroupIds = new Set(fullItems.map(i => i.itemGroupId).filter(Boolean))
  if (groups.size === 1 && itemGroupIds.size === 1) {
    const igId = fullItems.find(i => i.itemGroupId)?.itemGroupId
    if (igId) {
      const ig = await prisma.itemGroup.findUnique({ where: { id: igId } })
      if (ig) {
        await prisma.itemGroup.update({
          where: { id: igId },
          data: isSchematic
            ? {
                schematicX: (ig.schematicX ?? 0) + deltaLng,
                schematicY: (ig.schematicY ?? 0) + deltaLat,
              }
            : {
                locationLat: String(parseFloat(ig.locationLat) + deltaLat),
                locationLng: String(parseFloat(ig.locationLng) + deltaLng),
              },
        })
      }
    }
  }

  return { status: 'ok' }
}

export async function setItemStatusByGroup(itemGroupId: string, status: string) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  if (!isValidItemStatus(status)) throw new Error('Invalid item status')

  // Verify ownership via an item in this group
  const item = await prisma.inventoryItem.findFirst({
    where: { itemGroupId },
    select: { site: { select: { userId: true } } },
  })
  if (!item || item.site.userId !== session.user.id) throw new Error('Not authorized')

  await prisma.inventoryItem.updateMany({
    where: { itemGroupId },
    data: {
      status: status
    }
  })

  return { status: 'ok' }
  
}

export async function rotateSelection(
  siteId: string,
  itemIds: string[],
  deltaDegrees: number
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }
  if (itemIds.length === 0) return { status: 'ok' }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: {
      id: true,
      locationLat: true,
      locationLng: true,
      schematicX: true,
      schematicY: true,
      rotation: true,
    },
  })

  if (items.length === 0) return { status: 'ok' }

  // Compute centroid of the selection
  const centerLat = isSchematic
    ? items.reduce((s, i) => s + (i.schematicY ?? 0), 0) / items.length
    : items.reduce((s, i) => s + parseFloat(i.locationLat), 0) / items.length
  const centerLng = isSchematic
    ? items.reduce((s, i) => s + (i.schematicX ?? 0), 0) / items.length
    : items.reduce((s, i) => s + parseFloat(i.locationLng), 0) / items.length

  const rad = deltaDegrees * (Math.PI / 180)
  const metersPerLat = isSchematic ? 1 : 111320
  const metersPerLng = isSchematic ? 1 : 111320 * Math.cos(centerLat * Math.PI / 180)

  // Build all updates: orbit positions around centroid + update each chair's facing angle
  const updates = items.map((item) => {
    const itemY = isSchematic ? (item.schematicY ?? 0) : parseFloat(item.locationLat)
    const itemX = isSchematic ? (item.schematicX ?? 0) : parseFloat(item.locationLng)
    let newLatVal = itemY
    let newLngVal = itemX

    if (items.length > 1) {
      const dLat = itemY - centerLat
      const dLng = itemX - centerLng
      const dy = dLat * metersPerLat
      const dx = dLng * metersPerLng

      const newLatM = dy * Math.cos(rad) - dx * Math.sin(rad)
      const newLngM = dy * Math.sin(rad) + dx * Math.cos(rad)
      newLatVal = centerLat + newLatM / metersPerLat
      newLngVal = centerLng + newLngM / metersPerLng
    }

    const newRotation = Math.round((item.rotation ?? 0) + deltaDegrees)

    return prisma.inventoryItem.update({
      where: { id: item.id },
      data: isSchematic
        ? { schematicY: newLatVal, schematicX: newLngVal, rotation: newRotation }
        : { locationLat: String(newLatVal), locationLng: String(newLngVal), rotation: newRotation },
    })
  })

  // Execute all updates in a single transaction
  await prisma.$transaction(updates)

  // Persist rotation to ItemGroup if all items belong to the same group
  const fullItems = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { itemGroupId: true },
  })
  const uniqueGroupIds = new Set(fullItems.map(i => i.itemGroupId).filter(Boolean))
  if (uniqueGroupIds.size === 1) {
    const itemGroupId = [...uniqueGroupIds][0]!
    // Check all group members are included (complete parcel)
    const groupMemberCount = await prisma.inventoryItem.count({
      where: { itemGroupId, siteId },
    })
    if (groupMemberCount === itemIds.length) {
      const currentGroup = await prisma.itemGroup.findUnique({ where: { id: itemGroupId } })
      if (currentGroup) {
        // Update centroid from new positions
        const updatedItems = await prisma.inventoryItem.findMany({
          where: { id: { in: itemIds } },
          select: { locationLat: true, locationLng: true, schematicX: true, schematicY: true },
        })
        const newCenterLat = isSchematic
          ? updatedItems.reduce((s, i) => s + (i.schematicY ?? 0), 0) / updatedItems.length
          : updatedItems.reduce((s, i) => s + parseFloat(i.locationLat), 0) / updatedItems.length
        const newCenterLng = isSchematic
          ? updatedItems.reduce((s, i) => s + (i.schematicX ?? 0), 0) / updatedItems.length
          : updatedItems.reduce((s, i) => s + parseFloat(i.locationLng), 0) / updatedItems.length
        await prisma.itemGroup.update({
          where: { id: itemGroupId },
          data: isSchematic
            ? {
                rotation: Math.round(currentGroup.rotation + deltaDegrees),
                schematicY: newCenterLat,
                schematicX: newCenterLng,
              }
            : {
                rotation: Math.round(currentGroup.rotation + deltaDegrees),
                locationLat: String(newCenterLat),
                locationLng: String(newCenterLng),
              },
        })
      }
    }
  }

  return { status: 'ok' }
}

export async function adjustItemSpacing(
  siteId: string,
  itemIds: string[],
  axis: 'horizontal' | 'vertical',
  factor: number
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }
  if (itemIds.length < 2) return { status: 'ok' }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: {
      id: true,
      locationLat: true,
      locationLng: true,
      schematicX: true,
      schematicY: true,
      rotation: true,
    },
  })

  if (items.length < 2) return { status: 'ok' }

  // Compute centroid
  const centerLat = isSchematic
    ? items.reduce((s, i) => s + (i.schematicY ?? 0), 0) / items.length
    : items.reduce((s, i) => s + parseFloat(i.locationLat), 0) / items.length
  const centerLng = isSchematic
    ? items.reduce((s, i) => s + (i.schematicX ?? 0), 0) / items.length
    : items.reduce((s, i) => s + parseFloat(i.locationLng), 0) / items.length

  // Average rotation to determine the group's axes
  const avgRotation = items.reduce((s, i) => s + (i.rotation || 0), 0) / items.length
  const rad = avgRotation * (Math.PI / 180)
  const metersPerLat = isSchematic ? 1 : 111320
  const metersPerLng = isSchematic ? 1 : 111320 * Math.cos(centerLat * Math.PI / 180)

  await Promise.all(
    items.map((item) => {
      const itemY = isSchematic ? (item.schematicY ?? 0) : parseFloat(item.locationLat)
      const itemX = isSchematic ? (item.schematicX ?? 0) : parseFloat(item.locationLng)
      const dLat = itemY - centerLat
      const dLng = itemX - centerLng

      // Convert to meters (dy=north, dx=east)
      const dy = dLat * metersPerLat
      const dx = dLng * metersPerLng

      // Project onto rotated axes matching generateChairs convention:
      // In generateChairs: lat = dy*cos - dx*sin, lng = dy*sin + dx*cos
      // So "vertical" (row) component = dy*cos - dx*sin (lat-dominant)
      // And "horizontal" (col) component = dy*sin + dx*cos (lng-dominant)
      // Inverse: given (latM, lngM) from offsets, recover (v, h):
      //   v = latM*cos + lngM*sin,  h = -latM*sin + lngM*cos
      // But we're working with (dy, dx) directly in meters:
      const hComponent = -dy * Math.sin(rad) + dx * Math.cos(rad)
      const vComponent = dy * Math.cos(rad) + dx * Math.sin(rad)

      const newH = axis === 'horizontal' ? hComponent * factor : hComponent
      const newV = axis === 'vertical' ? vComponent * factor : vComponent

      // Convert back: lat = v*cos - h*sin, lng = v*sin + h*cos
      const newLatM = newV * Math.cos(rad) - newH * Math.sin(rad)
      const newLngM = newV * Math.sin(rad) + newH * Math.cos(rad)

      const newLat = centerLat + newLatM / metersPerLat
      const newLng = centerLng + newLngM / metersPerLng

      return prisma.inventoryItem.update({
        where: { id: item.id },
        data: isSchematic
          ? { schematicY: newLat, schematicX: newLng }
          : { locationLat: String(newLat), locationLng: String(newLng) },
      })
    })
  )

  // Persist gap changes to ItemGroup if all items belong to the same group
  const fullItems = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { itemGroupId: true },
  })
  const uniqueGroupIds = new Set(fullItems.map(i => i.itemGroupId).filter(Boolean))
  if (uniqueGroupIds.size === 1) {
    const itemGroupId = [...uniqueGroupIds][0]!
    const groupMemberCount = await prisma.inventoryItem.count({
      where: { itemGroupId, siteId },
    })
    if (groupMemberCount === itemIds.length) {
      const currentGroup = await prisma.itemGroup.findUnique({ where: { id: itemGroupId } })
      if (currentGroup) {
        // Update centroid from new positions
        const updatedItems = await prisma.inventoryItem.findMany({
          where: { id: { in: itemIds } },
          select: { locationLat: true, locationLng: true, schematicX: true, schematicY: true },
        })
        const newCenterLat = isSchematic
          ? updatedItems.reduce((s, i) => s + (i.schematicY ?? 0), 0) / updatedItems.length
          : updatedItems.reduce((s, i) => s + parseFloat(i.locationLat), 0) / updatedItems.length
        const newCenterLng = isSchematic
          ? updatedItems.reduce((s, i) => s + (i.schematicX ?? 0), 0) / updatedItems.length
          : updatedItems.reduce((s, i) => s + parseFloat(i.locationLng), 0) / updatedItems.length
        await prisma.itemGroup.update({
          where: { id: itemGroupId },
          data: isSchematic
            ? {
                ...(axis === 'horizontal'
                  ? { horizontalGap: currentGroup.horizontalGap * factor }
                  : { verticalGap: currentGroup.verticalGap * factor }),
                schematicY: newCenterLat,
                schematicX: newCenterLng,
              }
            : {
                ...(axis === 'horizontal'
                  ? { horizontalGap: currentGroup.horizontalGap * factor }
                  : { verticalGap: currentGroup.verticalGap * factor }),
                locationLat: String(newCenterLat),
                locationLng: String(newCenterLng),
              },
        })
      }
    }
  }

  return { status: 'ok' }
}

export async function assignItemsToGroup(
  siteId: string,
  itemIds: string[],
  group: number
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (itemIds.length === 0) return { status: 'ok' }

  await prisma.inventoryItem.updateMany({
    where: { id: { in: itemIds }, siteId },
    data: { group, itemGroupId: null },
  })

  return { status: 'ok' }
}

export async function removeItemsFromGroup(
  siteId: string,
  itemIds: string[]
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  if (itemIds.length === 0) return { status: 'ok' }

  await prisma.inventoryItem.updateMany({
    where: { id: { in: itemIds }, siteId },
    data: { group: 0, itemGroupId: null },
  })

  return { status: 'ok' }
}
