'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import dayjs from 'dayjs'
import { SchematicRenderer } from '@repo/schematic'
import type { LayoutElementDTO, SchematicItem } from '@repo/schematic/types'
import { InventoryItem, SiteProps } from '@/app/sites/types'
import { setValue } from '@/store/features/sites/sitesSlice'
import { toggleSeatSelection } from '@/app/sites/[id]/seat-selection'
import { RootState } from '@/store/store'
import { useGetAvailabilityBySiteAndTimeRangeQuery } from '@/store/features/api/apiSlice'
import { beachPalette } from './schematicPalette'
import sunbedImg from './sunbed-perforated-transparent.png'
import towelImg from './beach-towel-transparent.png'

const STATUS_FILL = {
  available: 'green',
  selected: 'blue',
  unavailable: 'red',
}

export default function SchematicSelection({ site }: { site: SiteProps }) {
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationMode, selectedItems } = sitesState

  const reservationDay = sitesState.reservationDay || dayjs().toDate()
  const timeRange = sitesState.timeRange || [
    dayjs().add(2, 'hour').toDate().toISOString(),
    dayjs().add(4, 'hour').toDate().toISOString(),
  ]
  const dateRange = sitesState.dateRange || [
    dayjs().startOf('day').toISOString(),
    dayjs().add(1, 'day').endOf('day').toISOString(),
  ]
  let availabilityFrom = dateRange[0]
  let availabilityTo = dateRange[1]
  if (reservationMode === 'hours') {
    const t0 = dayjs(timeRange[0])
    const t1 = dayjs(timeRange[1])
    availabilityFrom = dayjs(reservationDay)
      .hour(t0.hour()).minute(t0.minute()).second(t0.second()).toISOString()
    availabilityTo = dayjs(reservationDay)
      .hour(t1.hour()).minute(t1.minute()).second(t1.second()).toISOString()
  }

  const { data: availabilityResponse } = useGetAvailabilityBySiteAndTimeRangeQuery({
    siteId: site.id,
    from: availabilityFrom,
    to: availabilityTo,
  })

  // Track 020 P3: O(1) lookups instead of linear `.find`s — `itemVisual` below
  // is invoked per item by the renderer on every paint, and each call did both
  // an inventory find AND an availability find (O(n·(n+m)) stacked on the
  // renderer's own per-item pass).
  const availableIds = useMemo(
    () =>
      new Set(
        (availabilityResponse?.availability ?? [])
          .filter((a: any) => a.available)
          .map((a: any) => a.itemId)
      ),
    [availabilityResponse]
  )

  const isAvailable = (item: InventoryItem): boolean =>
    !!availabilityResponse && availableIds.has(item.id)

  const inventoryItems = useMemo(() => site.inventoryItems ?? [], [site.inventoryItems])

  const itemById = useMemo(
    () => new Map(inventoryItems.map((i) => [i.id, i])),
    [inventoryItems]
  )

  useEffect(() => {
    if (!availabilityResponse) return
    const filtered = (selectedItems ?? []).filter((it: InventoryItem) => isAvailable(it))
    dispatch(setValue({ selectedItems: filtered }))
    if (!sitesState.dateRange) {
      dispatch(setValue({ dateRange: [availabilityFrom, availabilityTo] }))
    }
  }, [availabilityResponse])

  // Whole-unit by default; per-seat once a unit is in play when the site
  // allows partial group booking — see `seat-selection.ts`.
  const partialGroupBooking = site.partialGroupBookingEnabled ?? false

  const toggleSelection = (itemId: string): void => {
    const item = itemById.get(itemId)
    if (!item || !isAvailable(item)) return
    const updated = toggleSeatSelection(item, selectedItems, {
      partialGroupBooking,
      isAvailable,
      resolveItem: (id) => itemById.get(id),
    })
    if (updated === selectedItems) return
    dispatch(setValue({ selectedItems: updated }))
  }

  // Stable identities matter downstream: SchematicRenderer memoizes its
  // derived structures on `elements`/`items` — rebuilding these arrays every
  // render would defeat that (track 020 P3).
  const elements: LayoutElementDTO[] = useMemo(
    () =>
      (site.layoutElements ?? []).map((el) => ({
        id: el.id,
        type: el.type,
        shape: (el.shape as 'rect' | 'ellipse' | 'icon') ?? 'rect',
        x: el.x, y: el.y, width: el.width, height: el.height,
        rotation: el.rotation ?? 0,
        z: el.z ?? 0,
        label: el.label ?? null,
        color: el.color ?? null,
      })),
    [site.layoutElements]
  )

  const items: SchematicItem[] = useMemo(
    () =>
      inventoryItems.map((it) => ({
        id: it.id,
        x: it.schematicX ?? 0,
        y: it.schematicY ?? 0,
        rotation: it.rotation ?? 0,
        status: it.status,
        label: undefined,
      })),
    [inventoryItems]
  )

  const selectedIds = useMemo(
    () => new Set<string>((selectedItems ?? []).map((s: { id: string }) => s.id)),
    [selectedItems]
  )

  return (
    <SchematicRenderer
      world={{ width: site.layoutWidth ?? 50, height: site.layoutHeight ?? 35 }}
      paletteConfig={beachPalette}
      elements={elements}
      items={items}
      itemVisual={(it) => {
        const inv = itemById.get(it.id)
        const available = inv ? isAvailable(inv) : false
        const isSelected = selectedIds.has(it.id)
        return {
          fill: !available
            ? STATUS_FILL.unavailable
            : isSelected
              ? STATUS_FILL.selected
              : STATUS_FILL.available,
          stroke: 'black',
          label: it.label ?? undefined,
          sunbedImageUrl: sunbedImg.src,
          towelImageUrl: (isSelected || !available) ? towelImg.src : undefined,
        }
      }}
      mode="view"
      selection={{ itemIds: Array.from(selectedIds) }}
      onItemClick={(id) => toggleSelection(id)}
    />
  )
}
