'use client'

import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import dayjs from 'dayjs'
import { SchematicRenderer } from '@repo/schematic'
import type { LayoutElementDTO, SchematicItem } from '@repo/schematic/types'
import { InventoryItem, SiteProps } from '@/app/sites/types'
import { setValue } from '@/store/features/sites/sitesSlice'
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

const getPairedItem = (item: InventoryItem): { id: string } | null | undefined =>
  item.pair || item.pairedBy

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

  const isAvailable = (item: InventoryItem): boolean => {
    if (!availabilityResponse) return false
    return !!availabilityResponse.availability.find((a: any) => a.itemId === item.id && a.available)
  }

  const inventoryItems = site.inventoryItems ?? []

  useEffect(() => {
    if (!availabilityResponse) return
    const filtered = (selectedItems ?? []).filter((it: InventoryItem) => isAvailable(it))
    dispatch(setValue({ selectedItems: filtered }))
    if (!sitesState.dateRange) {
      dispatch(setValue({ dateRange: [availabilityFrom, availabilityTo] }))
    }
  }, [availabilityResponse])

  const toggleSelection = (itemId: string): void => {
    const item = inventoryItems.find((i) => i.id === itemId)
    if (!item || !isAvailable(item)) return
    const alreadySelected = selectedItems?.some((sel: { id: string }) => sel.id === item.id)
    let updated = [...(selectedItems || [])]
    if (alreadySelected) {
      updated = updated.filter((sel: { id: string }) => sel.id !== item.id)
      const paired = getPairedItem(item)
      if (paired) updated = updated.filter((sel: { id: string }) => sel.id !== paired.id)
    } else {
      updated.push(item)
      const paired = getPairedItem(item)
      if (paired && !updated.some((sel: { id: string }) => sel.id === paired.id)) {
        const pairItem = inventoryItems.find((i) => i.id === paired.id)
        if (pairItem) updated.push(pairItem)
      }
    }
    dispatch(setValue({ selectedItems: updated }))
  }

  const elements: LayoutElementDTO[] = (site.layoutElements ?? []).map((el) => ({
    id: el.id,
    type: el.type,
    shape: (el.shape as 'rect' | 'ellipse' | 'icon') ?? 'rect',
    x: el.x, y: el.y, width: el.width, height: el.height,
    rotation: el.rotation ?? 0,
    z: el.z ?? 0,
    label: el.label ?? null,
    color: el.color ?? null,
  }))

  const items: SchematicItem[] = inventoryItems.map((it) => ({
    id: it.id,
    x: it.schematicX ?? 0,
    y: it.schematicY ?? 0,
    rotation: it.rotation ?? 0,
    status: it.status,
    label: undefined,
  }))

  const selectedIds = new Set<string>((selectedItems ?? []).map((s: { id: string }) => s.id))

  return (
    <SchematicRenderer
      world={{ width: site.layoutWidth ?? 50, height: site.layoutHeight ?? 35 }}
      paletteConfig={beachPalette}
      elements={elements}
      items={items}
      itemVisual={(it) => {
        const inv = inventoryItems.find((x) => x.id === it.id)
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
