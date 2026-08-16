'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { isValidItemStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import { TERMINAL_STATUSES } from '@repo/data/reservation-status'

import { generateChairs, generateChairsSchematic, ChairConfig } from './chair-util'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'
import {
  ensurePlacedSeatsHaveUnits,
  pruneEmptyUnits,
  devicesBlockingSeatRemoval,
  deviceRemovalError,
} from '@repo/data/unit'

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

  // Validate ChairConfig before any DB writes
  if (typeof config.price === 'number' && config.price < 0) {
    return { status: 'error', errors: ['Price must be non-negative'] }
  }
  if (config.rows < 1) {
    return { status: 'error', errors: ['rows must be at least 1'] }
  }
  if (config.seatsPerRow < 1) {
    return { status: 'error', errors: ['Seats per row must be at least 1'] }
  }

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

    // Track 020 P4: one createMany instead of one INSERT per seat — creating a
    // 60-seat parcel was 60 statements.
    await prisma.inventoryItem.createMany({
      data: generated.map((item) => ({
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
        pairId: null,
      })),
    })
  }

  if (mode === 'rearrange') {

    // Pool seats (group extras) are EXCLUDED from the rearrange entirely: they
    // carry sentinel coordinates (~0,0 — "null island"), so including them
    //   (a) poisons the centroid-preservation average below — with 60 real
    //       seats and 6 pool seats the "old centroid" lands at 60/66 of the
    //       true latitude, shifting the whole parcel ~3° toward the equator
    //       PER APPLY and persisting the corrupted anchor (each further apply
    //       multiplies by 60/66 again — the Brisa Marina parcel-1 teleport,
    //       2026-08-15, was exactly (60/66)^10 of the site coords);
    //   (b) risks a pool seat being "assigned to a leftover generated
    //       position" by the unmatched pass below, teleporting it into the
    //       grid and renumbering it out of the pool band;
    //   (c) lets a pool seat (which never has an itemGroupId) land at
    //       existing[0] and trigger a DUPLICATE ItemGroup create.
    const existing = await prisma.inventoryItem.findMany({
      where: { siteId, group, status: { not: 'pool' } },
      select: {
        id: true,
        number: true,
        itemGroupId: true,
        sunbedGroupId: true,
        locationLat: true,
        locationLng: true,
        schematicX: true,
        schematicY: true,
      }
    })

    // Preserve the visual centroid across the rearrange so rotation pivots
    // around the parcel center rather than the first seat.
    //
    // SANITY GUARD: in every legitimate flow this shift is tiny — the grid is
    // regenerated at the parcel's own anchor, so old and new centroids differ
    // by at most a shape tweak (metres). A large shift means the centroid is
    // poisoned (sentinel coords, corrupt anchor) — applying AND PERSISTING it
    // teleports the parcel and compounds on every retry, which is exactly how
    // an operator's "set rotation back to 0" makes things worse. Skip the
    // shift instead: the grid regenerates at the stored anchor, which is the
    // recoverable behaviour.
    // Geo shifts are in degrees (0.01° ≈ 1.1 km); schematic shifts are in
    // world units (a legit shape tweak moves the centroid well under 10).
    const MAX_CENTROID_SHIFT = isSchematic ? 10 : 0.01
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
        if (Number.isFinite(dx) && Number.isFinite(dy) &&
            Math.abs(dx) <= MAX_CENTROID_SHIFT && Math.abs(dy) <= MAX_CENTROID_SHIFT) {
          shiftedGenerated = generated.map((g) => ({
            ...g,
            schematicX: (g.schematicX ?? 0) + dx,
            schematicY: (g.schematicY ?? 0) + dy,
          })) as typeof generated
          shiftedGroupData = {
            ...itemGroupData,
            schematicX: (itemGroupData.schematicX ?? 0) + dx,
            schematicY: (itemGroupData.schematicY ?? 0) + dy,
          }
        }
      } else {
        const oldCLat = existing.reduce((s, i) => s + parseFloat(i.locationLat), 0) / existing.length
        const oldCLng = existing.reduce((s, i) => s + parseFloat(i.locationLng), 0) / existing.length
        const newCLat = generated.reduce((s, g) => s + parseFloat(g.locationLat), 0) / generated.length
        const newCLng = generated.reduce((s, g) => s + parseFloat(g.locationLng), 0) / generated.length
        const dLat = oldCLat - newCLat
        const dLng = oldCLng - newCLng
        if (Number.isFinite(dLat) && Number.isFinite(dLng) &&
            Math.abs(dLat) <= MAX_CENTROID_SHIFT && Math.abs(dLng) <= MAX_CENTROID_SHIFT) {
          shiftedGenerated = generated.map((g) => ({
            ...g,
            locationLat: (parseFloat(g.locationLat) + dLat).toString(),
            locationLng: (parseFloat(g.locationLng) + dLng).toString(),
          })) as typeof generated
          shiftedGroupData = {
            ...itemGroupData,
            locationLat: (parseFloat(itemGroupData.locationLat) + dLat).toString(),
            locationLng: (parseFloat(itemGroupData.locationLng) + dLng).toString(),
          }
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

    // Pair each existing seat with its generated position: first by seat
    // number, then remaining unmatched seats take leftover generated
    // positions in order (so every seat in the group gets repositioned).
    const assignments: Array<{ id: string; gen: (typeof shiftedGenerated)[number] }> = []
    for (const gen of shiftedGenerated) {
      const id = numberToId.get(gen.number)
      if (id) {
        matchedIds.add(id)
        assignments.push({ id, gen })
      }
    }
    const unmatchedExisting = existing.filter((e) => !matchedIds.has(e.id))
    const unmatchedGenerated = shiftedGenerated.filter((g) => !numberToId.has(g.number))
    unmatchedExisting.forEach((existingItem, idx) => {
      const gen = unmatchedGenerated[idx]
      if (!gen) return
      matchedIds.add(existingItem.id)
      assignments.push({ id: existingItem.id, gen })
    })

    // Track 020: this was one UPDATE per seat via Promise.all — a rotation of
    // a 60-seat parcel was 60 statements (founder-reported multi-second
    // rotations). One set-based UPDATE ... FROM unnest() per rearrange.
    // category/price mirror the old Prisma semantics: undefined = leave the
    // column untouched (Prisma skipped the field), not NULL it.
    if (assignments.length > 0 && itemGroup) {
      const ids = assignments.map((a) => a.id)
      const numbers = assignments.map((a) => a.gen.number)
      const groups = assignments.map((a) => a.gen.group)
      const rotations = assignments.map((a) => a.gen.rotation ?? 0)
      const categorySet = config.category !== undefined
        ? Prisma.sql`category = ${config.category},`
        : Prisma.empty
      const priceSet = config.price !== undefined
        ? Prisma.sql`price = ${config.price},`
        : Prisma.empty

      if (isSchematic) {
        const xs = assignments.map((a) => a.gen.schematicX ?? 0)
        const ys = assignments.map((a) => a.gen.schematicY ?? 0)
        await prisma.$executeRaw`
          UPDATE "InventoryItem" i SET
            item_group_id = ${itemGroup.id},
            schematic_x = v.sx,
            schematic_y = v.sy,
            rotation = v.rot,
            number = v.num,
            "group" = v.grp,
            ${categorySet}
            ${priceSet}
            pair_id = NULL,
            "updatedAt" = now()
          FROM (
            SELECT unnest(${ids}::text[]) AS id,
                   unnest(${xs}::float8[]) AS sx,
                   unnest(${ys}::float8[]) AS sy,
                   unnest(${rotations}::int[]) AS rot,
                   unnest(${numbers}::int[]) AS num,
                   unnest(${groups}::int[]) AS grp
          ) v
          WHERE i.id = v.id`
      } else {
        const lats = assignments.map((a) => a.gen.locationLat)
        const lngs = assignments.map((a) => a.gen.locationLng)
        await prisma.$executeRaw`
          UPDATE "InventoryItem" i SET
            item_group_id = ${itemGroup.id},
            location_lat = v.lat,
            location_lng = v.lng,
            rotation = v.rot,
            number = v.num,
            "group" = v.grp,
            ${categorySet}
            ${priceSet}
            pair_id = NULL,
            "updatedAt" = now()
          FROM (
            SELECT unnest(${ids}::text[]) AS id,
                   unnest(${lats}::text[]) AS lat,
                   unnest(${lngs}::text[]) AS lng,
                   unnest(${rotations}::int[]) AS rot,
                   unnest(${numbers}::int[]) AS num,
                   unnest(${groups}::int[]) AS grp
          ) v
          WHERE i.id = v.id`
      }
    }

    // ── Track 021 P4: RESIZE ────────────────────────────────────────────────
    // Until now a rearrange only ever REPOSITIONED seats: growing a parcel left
    // the new positions empty and shrinking stranded the surplus seats where
    // they stood, so the only way to change dimensions was to delete the parcel
    // and rebuild it — which destroys every unit identity on it (and, once
    // devices are assigned, every location they answer for). Overlapping spots
    // keep their seat ids, unit ids and persisted ordinals; only the difference
    // is created or removed.
    const surplusSeats = unmatchedExisting.slice(unmatchedGenerated.length)
    const vacantPositions = unmatchedGenerated.slice(unmatchedExisting.length)

    if (surplusSeats.length > 0) {
      const surplusIds = surplusSeats.map((seat) => seat.id)

      // A shrink must never silently delete a bed someone has booked. The
      // parcel-delete path has no such guard, which is one more reason resize
      // should be the way dimensions change.
      const booked = await prisma.reservation.findMany({
        where: {
          siteId,
          to: { gte: new Date() },
          status: { notIn: [...TERMINAL_STATUSES] },
          items: { some: { id: { in: surplusIds } } },
        },
        select: { id: true },
        take: 1,
      })
      // I5: a shrink that dismounts a spot with hardware on it is refused too —
      // the same rule as an explicit delete, since the outcome is identical.
      const blocking = await devicesBlockingSeatRemoval(siteId, surplusIds)
      if (blocking.length > 0) {
        return { status: 'error', errors: [deviceRemovalError(blocking)] }
      }

      if (booked.length > 0) {
        return {
          status: 'error',
          errors: [
            `Cannot shrink this parcel: ${surplusSeats.length} seat(s) being removed have current or future reservations. Release them first.`,
          ],
        }
      }

      const emptiedUnits = [
        ...new Set(surplusSeats.map((seat) => seat.sunbedGroupId).filter(Boolean) as string[]),
      ]
      await prisma.$transaction([
        // The legacy self-FK still bites until the column is dropped.
        prisma.inventoryItem.updateMany({
          where: { pairId: { in: surplusIds } },
          data: { pairId: null },
        }),
        prisma.inventoryItem.deleteMany({ where: { id: { in: surplusIds }, siteId } }),
      ])
      await pruneEmptyUnits(siteId, emptiedUnits)
    }

    if (vacantPositions.length > 0 && itemGroup) {
      await prisma.inventoryItem.createMany({
        data: vacantPositions.map((position) => ({
          userId: session?.user?.id,
          itemGroupId: itemGroup.id,
          siteId,
          status: 'active',
          locationLat: position.locationLat,
          locationLng: position.locationLng,
          ...(isSchematic
            ? { schematicX: position.schematicX, schematicY: position.schematicY }
            : {}),
          rotation: position.rotation,
          number: position.number,
          group: position.group,
          category: config.category,
          price: config.price,
        })),
      })
      // Units for the new seats are minted by ensurePlacedSeatsHaveUnits below
      // (or paired into two-member units by assignChairPairings first).
    }
  }

  await assignChairPairings({ generated, group, siteId })

  // Track 021 P2 (I1): pairing only groups seats when `pairSeats` is on, so a
  // parcel created without pairing would leave every seat unitless. Give any
  // placed seat that still has no unit one of its own — scoped to this parcel,
  // idempotent, and set-based (a pairing-off parcel can be 500 seats).
  await ensurePlacedSeatsHaveUnits(siteId, { group })

  await recomputeSeatLabels(siteId)
  revalidatePath('/sites')
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
    select: { id: true, number: true, sunbedGroupId: true },
  })

  const numberToId = new Map(allItems.map((i) => [i.number, i.id]))
  const idToSunbedGroupId = new Map(allItems.map((i) => [i.id, i.sunbedGroupId]))
  const tempToNumber = new Map(generated.map((i) => [i.tempId, i.number]))

  // Track 020 P4: the old shape was a sequential `for` with 3-5 awaited
  // round-trips per pair (~150 serialized queries after creating a 60-seat
  // paired parcel), and it deleted prior SunbedGroups per pair — so re-pairing
  // seats across two old pairs (old pair (A,B) → new pairs (A,C) + (B,D)) hit
  // the same dissolved group twice and threw P2025 on the second delete.
  // Now: resolve everything in memory first, then one atomic transaction.

  // 1. Resolve the pair list — pure computation, no I/O.
  const pairs: Array<{ itemId: string; pairId: string }> = []
  for (const item of generated) {
    if (!item.pairTempId || !item.isPrimary) continue
    const itemId = numberToId.get(item.number)
    const pairNumber = tempToNumber.get(item.pairTempId)
    const pairId = pairNumber ? numberToId.get(pairNumber) : undefined
    if (!itemId || !pairId) continue
    // Whether this pair needs a NEW SunbedGroup is decided below (idempotent
    // skip for pairs already sharing one).
    pairs.push({ itemId, pairId })
  }
  if (pairs.length === 0) return

  // 2. Decide which UNIT each pair should live in.
  //
  // Track 021 P4 (A2): re-pairing used to dissolve every prior unit and mint
  // fresh ones, so changing a parcel's shape threw away unit identity — new
  // ids, and with them the persisted label ordinal and (once assigned) the
  // device location. A unit is the physical spot; re-pairing rearranges which
  // beds share it, which is not a reason for the spot to cease existing.
  //
  // So: a pair REUSES one of its members' existing units where it can, and only
  // genuinely new pairs mint. Units left with no members are pruned afterwards
  // (an emptied spot is a dismounted parasol — see Q5).
  const reusedUnitIds = new Set<string>()
  const touchedUnitIds = new Set<string>()
  const pairPlacements: Array<{ itemId: string; pairId: string; unitId: string | null }> = []

  for (const { itemId, pairId } of pairs) {
    const a = idToSunbedGroupId.get(itemId) ?? null
    const b = idToSunbedGroupId.get(pairId) ?? null
    if (a) touchedUnitIds.add(a)
    if (b) touchedUnitIds.add(b)

    // Already one unit — nothing to write, identity trivially preserved.
    if (a && a === b) continue

    // Prefer keeping a unit one of the two members already belongs to. The
    // `reusedUnitIds` guard stops two different pairs claiming the same unit
    // (possible when a former unit's members are split across new pairs).
    const keep = [a, b].find((id): id is string => !!id && !reusedUnitIds.has(id)) ?? null
    if (keep) reusedUnitIds.add(keep)
    pairPlacements.push({ itemId, pairId, unitId: keep })
  }

  const pairsNeedingGroup = pairPlacements.filter((p) => p.unitId === null)
  const pairsReusingGroup = pairPlacements.filter((p) => p.unitId !== null)

  // Reusing a unit means the PAIR occupies it — so any current member that is
  // not part of that pair has to leave, or a two-bed spot quietly becomes a
  // three-bed one (and a device there would light a segment for a bed that is
  // not under that parasol). Evicted seats are detached here and given their
  // own unit by ensurePlacedSeatsHaveUnits immediately after.
  const claimedMembers = new Map<string, Set<string>>()
  for (const placement of pairsReusingGroup) {
    claimedMembers.set(placement.unitId!, new Set([placement.itemId, placement.pairId]))
  }
  const evictedIds = allItems
    .filter(
      (item) =>
        item.sunbedGroupId &&
        claimedMembers.has(item.sunbedGroupId) &&
        !claimedMembers.get(item.sunbedGroupId)!.has(item.id),
    )
    .map((item) => item.id)

  // Track 021 P1: the legacy `pairId` dual-write is gone — `SunbedGroup` is the
  // sole representation of pairing, and every reader in both apps was already
  // group-first (their pairId branches were labelled fallbacks and, per the P0
  // audit, unreachable: no row in dev/test/production has a pairId without a
  // group). The column itself is dropped in a later release.
  //
  // The pure-rotation fast path from track 020 is preserved: when nothing about
  // the grouping changes, this writes NOTHING and skips the transaction (that
  // was the founder's multi-second rotation).
  if (pairPlacements.length === 0) {
    return
  }

  // 3. One atomic transaction, every step set-based: dissolve priors, mint the
  //    new 2-seat groups, batched membership assignment.
  await prisma.$transaction(async (tx) => {
    if (evictedIds.length > 0) {
      await tx.inventoryItem.updateMany({
        where: { id: { in: evictedIds } },
        data: { sunbedGroupId: null },
      })
    }

    // Members move INTO the chosen unit; nothing is dissolved first, so a
    // reused unit keeps its id, its ordinal and anything bound to it.
    if (pairsReusingGroup.length > 0) {
      const memberIds = pairsReusingGroup.flatMap((p) => [p.itemId, p.pairId])
      const memberUnitIds = pairsReusingGroup.flatMap((p) => [p.unitId!, p.unitId!])
      await tx.$executeRaw`
        UPDATE "InventoryItem" i SET sunbed_group_id = v.gid, "updatedAt" = now()
        FROM (
          SELECT unnest(${memberIds}::text[]) AS id,
                 unnest(${memberUnitIds}::text[]) AS gid
        ) v
        WHERE i.id = v.id`
    }

    if (pairsNeedingGroup.length > 0) {
      // createManyAndReturn preserves input order, so index i maps pair i to
      // its minted group.
      const newGroups = await tx.sunbedGroup.createManyAndReturn({
        data: pairsNeedingGroup.map(() => ({ siteId })),
      })
      const memberIds = pairsNeedingGroup.flatMap(({ itemId, pairId }) => [itemId, pairId])
      const memberGroupIds = pairsNeedingGroup.flatMap((_, i) => {
        const gid = newGroups[i]!.id
        return [gid, gid]
      })
      await tx.$executeRaw`
        UPDATE "InventoryItem" i SET sunbed_group_id = v.gid, "updatedAt" = now()
        FROM (
          SELECT unnest(${memberIds}::text[]) AS id,
                 unnest(${memberGroupIds}::text[]) AS gid
        ) v
        WHERE i.id = v.id`
    }
  })

  // A former unit whose members all moved elsewhere is an empty spot; prune it.
  await pruneEmptyUnits(siteId, [...touchedUnitIds])
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
  targetLatOrY: number,
  targetLngOrX: number,
  anchorItemId?: string
) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  // ABSOLUTE-TARGET CONTRACT (track 020 / 2026-08-15 drag-jump fix): callers
  // send where something should END UP — the dragged seat (anchorItemId set)
  // or the ItemGroup anchor (reposition click) — and the DELTA is computed
  // HERE from the authoritative DB row. The old client-computed delta raced:
  // a second drag started before the first drag's refresh landed computed its
  // delta from stale coordinates, so the parcel visibly jumped on release
  // (reproduced at 23px with two rapid drags). With an absolute target the
  // anchor lands exactly where dropped regardless of client staleness — the
  // same reason single seats (saveInventoryItemLocation) were already
  // race-free.
  if (!Number.isFinite(targetLatOrY) || !Number.isFinite(targetLngOrX)) {
    return { status: 'error', errors: ['Invalid move target'] }
  }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  // Resolve the base the delta is measured from — inside the same transaction
  // as the writes, so a concurrent move cannot slip between read and write.

  // Track 020 P4: this was one UPDATE per seat via Promise.all with NO
  // transaction — a 60-seat parcel was 60 statements, and a partial failure
  // left the parcel silently half-moved. Two set-based statements (seats +
  // anchor) in one transaction: atomic, and independent of parcel size. Raw
  // SQL because the geo coordinates are String columns (Q5 in the track), so
  // the arithmetic needs a cast; `@updatedAt` is client-managed, so raw writes
  // must touch "updatedAt" themselves. Pool seats keep their sentinel
  // coordinates (excluded — they are not part of the parcel's geometry).
  const result = await prisma.$transaction(async (tx) => {
    // The base row is read FOR UPDATE: a second drag issued while this
    // transaction is in flight BLOCKS on the row lock until we commit, then
    // reads the fresh base — without the lock, its read could land before our
    // commit while its relative UPDATE landed after, and the deltas compound
    // (the drag-jump race, reproduced at 23-95px in-browser).
    type BaseRow = {
      location_lat: string
      location_lng: string
      schematic_x: number | null
      schematic_y: number | null
    }
    let baseRows: BaseRow[]
    if (anchorItemId) {
      baseRows = await tx.$queryRaw<BaseRow[]>`
        SELECT location_lat, location_lng, schematic_x, schematic_y
        FROM "InventoryItem"
        WHERE id = ${anchorItemId} AND site_id = ${siteId} AND "group" = ${group}
          AND status <> 'pool'
        FOR UPDATE`
    } else {
      baseRows = await tx.$queryRaw<BaseRow[]>`
        SELECT location_lat, location_lng, schematic_x, schematic_y
        FROM "ItemGroup"
        WHERE id IN (
          SELECT DISTINCT item_group_id FROM "InventoryItem"
          WHERE site_id = ${siteId} AND "group" = ${group} AND item_group_id IS NOT NULL
        )
        FOR UPDATE`
    }
    const base = baseRows[0]
    if (!base) return 'not_found' as const
    const baseLatOrY = isSchematic ? (base.schematic_y ?? 0) : parseFloat(base.location_lat)
    const baseLngOrX = isSchematic ? (base.schematic_x ?? 0) : parseFloat(base.location_lng)

    const deltaLat = targetLatOrY - baseLatOrY
    const deltaLng = targetLngOrX - baseLngOrX
    if (!Number.isFinite(deltaLat) || !Number.isFinite(deltaLng)) return 'invalid' as const

    if (isSchematic) {
      await tx.$executeRaw`
        UPDATE "InventoryItem"
        SET schematic_x = COALESCE(schematic_x, 0) + ${deltaLng},
            schematic_y = COALESCE(schematic_y, 0) + ${deltaLat},
            "updatedAt" = now()
        WHERE site_id = ${siteId} AND "group" = ${group} AND status <> 'pool'`
      await tx.$executeRaw`
        UPDATE "ItemGroup"
        SET schematic_x = COALESCE(schematic_x, 0) + ${deltaLng},
            schematic_y = COALESCE(schematic_y, 0) + ${deltaLat},
            "updatedAt" = now()
        WHERE id IN (
          SELECT DISTINCT item_group_id FROM "InventoryItem"
          WHERE site_id = ${siteId} AND "group" = ${group} AND item_group_id IS NOT NULL
        )`
    } else {
      await tx.$executeRaw`
        UPDATE "InventoryItem"
        SET location_lat = ((location_lat::float8) + ${deltaLat})::text,
            location_lng = ((location_lng::float8) + ${deltaLng})::text,
            "updatedAt" = now()
        WHERE site_id = ${siteId} AND "group" = ${group} AND status <> 'pool'`
      await tx.$executeRaw`
        UPDATE "ItemGroup"
        SET location_lat = ((location_lat::float8) + ${deltaLat})::text,
            location_lng = ((location_lng::float8) + ${deltaLng})::text,
            "updatedAt" = now()
        WHERE id IN (
          SELECT DISTINCT item_group_id FROM "InventoryItem"
          WHERE site_id = ${siteId} AND "group" = ${group} AND item_group_id IS NOT NULL
        )`
    }
    return 'ok' as const
  })

  if (result === 'not_found') return { status: 'error', errors: ['Parcel not found'] }
  if (result === 'invalid') return { status: 'error', errors: ['Invalid move target'] }
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

  // See moveParcel — a non-finite delta would corrupt the whole selection in
  // one set-based statement.
  if (!Number.isFinite(deltaLat) || !Number.isFinite(deltaLng)) {
    return { status: 'error', errors: ['Invalid move delta'] }
  }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  // Track 020 P4: one set-based statement instead of one UPDATE per item (see
  // moveParcel for the raw-SQL rationale). Pool sentinels excluded.
  if (isSchematic) {
    await prisma.$executeRaw`
      UPDATE "InventoryItem"
      SET schematic_x = COALESCE(schematic_x, 0) + ${deltaLng},
          schematic_y = COALESCE(schematic_y, 0) + ${deltaLat},
          "updatedAt" = now()
      WHERE id = ANY(${itemIds}) AND site_id = ${siteId} AND status <> 'pool'`
  } else {
    await prisma.$executeRaw`
      UPDATE "InventoryItem"
      SET location_lat = ((location_lat::float8) + ${deltaLat})::text,
          location_lng = ((location_lng::float8) + ${deltaLng})::text,
          "updatedAt" = now()
      WHERE id = ANY(${itemIds}) AND site_id = ${siteId} AND status <> 'pool'`
  }

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

  // Pool seats (group extras) sit at sentinel coordinates (~0,0) and must not
  // participate in geometry: including them drags the centroid toward null
  // island, and orbiting real seats around that poisoned centroid scatters
  // the parcel across degrees of latitude. The inventory view filters pool
  // from its selections, but server actions take arbitrary ids — the
  // exclusion belongs HERE so every caller is safe (same bug class as the
  // 2026-08-15 rearrange teleport, which was server-side pollution).
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId, status: { not: 'pool' } },
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

  // Schematic uses SVG Y-down, while the rotation matrix below is written for
  // Y-up (geographic). Invert the angle in schematic mode so the orbit matches
  // each seat's own CW tilt (same compensation generateChairsSchematic applies).
  const rad = (isSchematic ? -deltaDegrees : deltaDegrees) * (Math.PI / 180)
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
    // Check all group members are included (complete parcel). Compare against
    // the selected items that CARRY this itemGroupId — pool seats in the
    // selection have none and must not make a complete parcel look partial
    // (which silently skipped the anchor update, desyncing anchor from seats).
    const groupMemberCount = await prisma.inventoryItem.count({
      where: { itemGroupId, siteId },
    })
    const selectedGroupMembers = fullItems.filter(i => i.itemGroupId === itemGroupId).length
    if (groupMemberCount === selectedGroupMembers) {
      const currentGroup = await prisma.itemGroup.findUnique({ where: { id: itemGroupId } })
      if (currentGroup) {
        // Update centroid from new positions — parcel members only, never the
        // pool sentinels.
        const updatedItems = await prisma.inventoryItem.findMany({
          where: { id: { in: itemIds }, itemGroupId },
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
  // Guard against non-positive spacing factors before any DB read:
  // factor=0 collapses all items onto the centroid; factor<0 mirrors the layout.
  // Both corrupt coordinates in a way the user cannot undo.
  if (!Number.isFinite(factor) || factor <= 0) {
    return { status: 'error', errors: ['Spacing factor must be a positive number'] }
  }

  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }
  if (itemIds.length < 2) return { status: 'ok' }

  const isSchematic = (await getSiteLayoutMode(siteId)) === 'schematic'

  // Pool sentinels excluded from geometry — see rotateSelection. Spacing is
  // the worst case: scaling a pool seat's ~30° offset from the centroid by
  // `factor` would fling real seats across the hemisphere.
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, siteId, status: { not: 'pool' } },
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
    // Compare against selected items CARRYING this itemGroupId — pool seats in
    // the selection must not make a complete parcel look partial (see
    // rotateSelection).
    const selectedGroupMembers = fullItems.filter(i => i.itemGroupId === itemGroupId).length
    if (groupMemberCount === selectedGroupMembers) {
      const currentGroup = await prisma.itemGroup.findUnique({ where: { id: itemGroupId } })
      if (currentGroup) {
        // Update centroid from new positions — parcel members only.
        const updatedItems = await prisma.inventoryItem.findMany({
          where: { id: { in: itemIds }, itemGroupId },
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

  await recomputeSeatLabels(siteId)
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

  await recomputeSeatLabels(siteId)
  return { status: 'ok' }
}

/**
 * Reverse seat numbering within each row of a parcel.
 *
 * Beds stay physically in place — only their `number` field changes so the
 * sequence counts from the opposite end.  The seat-number suffix (last 2
 * digits of `number`) is remapped s_i → s_(n+1-i) for every seat in each
 * row.  Coordinates, rotation, and pairId are untouched.
 *
 * Number encoding: `Number(`${group}${rowNum2}${seatNum2}`)`.
 * The seat suffix is always the final 2 digits; everything before it is the
 * row prefix (group digits + 2-digit row).
 */
export async function reverseParcelNumbering(siteId: string, group: number) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const items = await prisma.inventoryItem.findMany({
    where: { siteId, group },
    select: { id: true, number: true },
  })

  if (items.length === 0) return { status: 'ok' }

  // Group items by row prefix (all digits except the last 2 = seat suffix).
  const rowMap = new Map<string, Array<{ id: string; number: number }>>()
  for (const item of items) {
    const numStr = String(item.number)
    const rowPrefix = numStr.slice(0, -2) // everything except last 2 digits
    if (!rowMap.has(rowPrefix)) rowMap.set(rowPrefix, [])
    rowMap.get(rowPrefix)!.push(item)
  }

  // Build all updates: for each row, sort by seat suffix ascending, then
  // remap s_i → s_(n+1-i) while keeping coordinates/rotation intact.
  const updates: Array<{ id: string; newNumber: number }> = []
  for (const [rowPrefix, rowItems] of rowMap) {
    // Sort by current seat suffix so indices are well-defined
    rowItems.sort((a, b) => a.number - b.number)

    const n = rowItems.length
    for (let i = 0; i < n; i++) {
      const reversedIndex = n - 1 - i
      const item = rowItems[i]!
      const reversedItem = rowItems[reversedIndex]!
      const originalSeatSuffix = String(reversedItem.number).slice(-2)
      const newNumber = Number(`${rowPrefix}${originalSeatSuffix}`)
      updates.push({ id: item.id, newNumber })
    }
  }

  // Execute atomically.  No uniqueness constraint on (siteId, number) means
  // we can do a single-pass update without a temp-offset stage.
  await prisma.$transaction(
    updates.map(({ id, newNumber }) =>
      prisma.inventoryItem.update({
        where: { id },
        data: { number: newNumber },
      })
    )
  )

  await recomputeSeatLabels(siteId)
  return { status: 'ok' }
}

/**
 * Reverse the orientation of every seat in a parcel — turn each 180°.
 *
 * Beds stay physically in place (coordinates untouched); only each seat's
 * `rotation` field is flipped by 180°, normalised into [0, 360). A null
 * rotation is treated as 0, so it becomes 180. Numbering and labels are
 * unaffected, so no `recomputeSeatLabels` is needed.
 */
export async function reverseParcelOrientation(siteId: string, group: number) {
  const { error } = await requireSiteOwner(siteId)
  if (error) return { status: 'error', errors: [error] }

  const items = await prisma.inventoryItem.findMany({
    where: { siteId, group },
    select: { id: true, rotation: true },
  })

  if (items.length === 0) return { status: 'ok' }

  await prisma.$transaction(
    items.map((item) =>
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: { rotation: ((((item.rotation ?? 0) + 180) % 360) + 360) % 360 },
      })
    )
  )

  return { status: 'ok' }
}
