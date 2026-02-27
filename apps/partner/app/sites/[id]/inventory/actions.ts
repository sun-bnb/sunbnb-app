'use server'

import { revalidatePath } from 'next/cache'
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
      console.log('save item group', existing[0]!.itemGroupId, itemGroupData)
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

  console.log('Save bg image:', key, meta.width, meta.height);
  // you can pass `file` directly too; using buffer lets you preprocess if needed
  const blob = await put(key, buf, {
    access: 'public',
    contentType: file.type || 'image/jpeg',
  })


  console.log('Update site data');
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
