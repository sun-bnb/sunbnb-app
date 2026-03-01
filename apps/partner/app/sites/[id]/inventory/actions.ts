'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import sharp from 'sharp'
import { put } from '@vercel/blob'

import { generateChairs, ChairConfig } from './chair-util'

type Mode = 'create' | 'rearrange'

export async function syncChairsWithLayout(siteId: string, config: ChairConfig, mode: Mode) {

  const session = await auth()
  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const generated = generateChairs(config)
  const group = config.group

  const itemGroupData = {
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
      select: { id: true, number: true, itemGroupId: true }
    })

    const numberToId = new Map(existing.map((e) => [e.number, e.id]))

    let itemGroup = null
    if (existing.length > 0 && !(existing[0]?.itemGroupId)) {
      itemGroup = await prisma.itemGroup.create({
        data: itemGroupData
      })
    } else {
      itemGroup = await prisma.itemGroup.update({
        where: { id: existing[0]!.itemGroupId! },
        data: itemGroupData
      })
    }

    // Track which existing items get matched to a generated position
    const matchedIds = new Set<string>()

    // Update existing chairs that match a generated position by number
    await Promise.all(
      generated.map((item) => {
        const id = numberToId.get(item.number)
        if (!id) return Promise.resolve()

        matchedIds.add(id)
        return prisma.inventoryItem.update({
          where: { id },
          data: {
            itemGroupId: itemGroup ? itemGroup.id : undefined,
            locationLat: item.locationLat,
            locationLng: item.locationLng,
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
    const unmatchedGenerated = generated.filter((g) => !numberToId.has(g.number))

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
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  const items = await prisma.inventoryItem.findMany({
    where: { siteId, group },
    select: { id: true, locationLat: true, locationLng: true, itemGroupId: true },
  })

  // Offset every item in the group by the delta
  await Promise.all(
    items.map((item) =>
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
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
        data: {
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
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  if (itemIds.length === 0) return { status: 'ok' }

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { id: true, locationLat: true, locationLng: true },
  })

  await Promise.all(
    items.map((item) =>
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
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
          data: {
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

  await prisma.inventoryItem.updateMany({
    where: { itemGroupId },
    data: {
      status: status
    }
  })

  return { status: 'ok' }
  
}

export async function saveBgOption(siteId: string, bgOption: string) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  await prisma.site.update({
    where: { id: siteId },
    data: {
      background: bgOption
    }
  })

  return { status: 'ok' }
  
}

export async function uploadBackground(siteId: string, formData: FormData) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const file = formData.get('image') as File | null
  if (!file || file.size === 0) throw new Error('No file')

  const buf = Buffer.from(await file.arrayBuffer())
  const meta = await sharp(buf).metadata()

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const key = `site/${siteId}/background.${ext}`

  const blob = await put(key, buf, {
    access: 'public',
    contentType: file.type || 'image/jpeg',
  })

  await prisma.site.update({
    where: { id: siteId },
    data: {
      bgImageUrl: blob.url,
      bgImageWidth: meta.width ?? null,
      bgImageHeight: meta.height ?? null,
    },
  })

  return { url: blob.url, width: meta.width ?? null, height: meta.height ?? null }
}

export async function rotateSelection(
  siteId: string,
  itemIds: string[],
  deltaDegrees: number
) {
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }
  if (itemIds.length === 0) return { status: 'ok' }

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { id: true, locationLat: true, locationLng: true, rotation: true },
  })

  if (items.length === 0) return { status: 'ok' }

  // Compute centroid of the selection
  const centerLat = items.reduce((s, i) => s + parseFloat(i.locationLat), 0) / items.length
  const centerLng = items.reduce((s, i) => s + parseFloat(i.locationLng), 0) / items.length

  const rad = deltaDegrees * (Math.PI / 180)
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos(centerLat * Math.PI / 180)

  // Build all updates: orbit positions around centroid + update each chair's facing angle
  const updates = items.map((item) => {
    let newLat: string
    let newLng: string

    if (items.length > 1) {
      const dLat = parseFloat(item.locationLat) - centerLat
      const dLng = parseFloat(item.locationLng) - centerLng
      const dy = dLat * metersPerLat  // north offset in meters
      const dx = dLng * metersPerLng  // east offset in meters

      // Orbit using same convention as generateChairs:
      // newLat = dy*cos - dx*sin,  newLng = dy*sin + dx*cos
      const newLatM = dy * Math.cos(rad) - dx * Math.sin(rad)
      const newLngM = dy * Math.sin(rad) + dx * Math.cos(rad)
      newLat = String(centerLat + newLatM / metersPerLat)
      newLng = String(centerLng + newLngM / metersPerLng)
    } else {
      newLat = item.locationLat
      newLng = item.locationLng
    }

    const newRotation = Math.round((item.rotation ?? 0) + deltaDegrees)

    return prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        locationLat: newLat,
        locationLng: newLng,
        rotation: newRotation,
      },
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
          select: { locationLat: true, locationLng: true },
        })
        const newCenterLat = updatedItems.reduce((s, i) => s + parseFloat(i.locationLat), 0) / updatedItems.length
        const newCenterLng = updatedItems.reduce((s, i) => s + parseFloat(i.locationLng), 0) / updatedItems.length
        await prisma.itemGroup.update({
          where: { id: itemGroupId },
          data: {
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
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }
  if (itemIds.length < 2) return { status: 'ok' }

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId },
    select: { id: true, locationLat: true, locationLng: true, rotation: true },
  })

  if (items.length < 2) return { status: 'ok' }

  // Compute centroid
  const centerLat = items.reduce((s, i) => s + parseFloat(i.locationLat), 0) / items.length
  const centerLng = items.reduce((s, i) => s + parseFloat(i.locationLng), 0) / items.length

  // Average rotation to determine the group's axes
  const avgRotation = items.reduce((s, i) => s + (i.rotation || 0), 0) / items.length
  const rad = avgRotation * (Math.PI / 180)
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos(centerLat * Math.PI / 180)

  await Promise.all(
    items.map((item) => {
      const dLat = parseFloat(item.locationLat) - centerLat
      const dLng = parseFloat(item.locationLng) - centerLng

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
        data: {
          locationLat: String(newLat),
          locationLng: String(newLng),
        },
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
          select: { locationLat: true, locationLng: true },
        })
        const newCenterLat = updatedItems.reduce((s, i) => s + parseFloat(i.locationLat), 0) / updatedItems.length
        const newCenterLng = updatedItems.reduce((s, i) => s + parseFloat(i.locationLng), 0) / updatedItems.length
        await prisma.itemGroup.update({
          where: { id: itemGroupId },
          data: {
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
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

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
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: ['Not authenticated'] }

  if (itemIds.length === 0) return { status: 'ok' }

  await prisma.inventoryItem.updateMany({
    where: { id: { in: itemIds }, siteId },
    data: { group: 0, itemGroupId: null },
  })

  return { status: 'ok' }
}
