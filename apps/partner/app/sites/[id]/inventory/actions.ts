'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

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

    // Update existing chairs in new layout
    await Promise.all(
      generated.map((item) => {
        const id = numberToId.get(item.number)
        if (!id) return Promise.resolve()

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