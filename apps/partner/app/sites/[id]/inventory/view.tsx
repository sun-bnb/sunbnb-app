'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { InventoryItem, SiteProps } from '@/types/shared'
import {
  createInventoryItem,
  saveInventoryItemLocation,
  deleteInventoryItem,
  deleteInventoryItems,
} from '../inventory-actions'
import { getSite, getInventoryItems, getItemsByGroups } from '../queries'
import { useSite } from '@/app/sites/site-context'
import ReadinessChecklist from '@/app/sites/readiness-checklist'
import InventoryForm from './InventoryForm'
import InventoryMap from './InventoryMap'
import InventoryToolbar from './InventoryToolbar'
import ParcelList from './ParcelList'
import ParcelForm from './ParcelForm'
import { MapMouseEvent } from '@vis.gl/react-google-maps'
import { ChairConfig, getParcelColor } from './chair-util'
import { syncChairsWithLayout, getItemGroup, moveParcel, moveItems, rotateSelection, adjustItemSpacing, assignItemsToGroup, removeItemsFromGroup } from './actions'
import { useSunbedEditing } from './useSunbedEditing'

export default function InventoryView() {

  const t = useTranslations('SiteInventory')
  const { site, setSite, apiKey } = useSite()
  const router = useRouter()

  // Exclude pool seats (status:'pool') from the inventory editor entirely.
  // Pool seats have sentinel coords (0,0) and must not appear in the map or stats.
  const inventory: InventoryItem[] = (site.inventoryItems || []).filter(i => i.status !== 'pool')
  const siteId = site.id || ''
  const siteLat = site.locationLat!
  const siteLng = site.locationLng!

  const [editorMode, setEditorMode] = useState<'none' | 'create-chair' | 'edit-chair' | 'create-parcel' | 'edit-parcel'>('none')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])

  const [editGroup, setEditGroup] = useState<number | null>(null)

  const [parcelConfig, setParcelConfig] = useState<ChairConfig>({
    rows: 6,
    seatsPerRow: 10,
    horizontalGap: 1,
    verticalGap: 1.5,
    rotation: 0,
    group: 1,
    category: 'PRICE1',
    price: site.price || 9,
    pairSeats: true,
    intraPairGap: 0.4,
    baseLat: Number(siteLat),
    baseLng: Number(siteLng),
  })

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  const [itemPanelOpen, setItemPanelOpen] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<any>(null)

  const refresh = async () => {
    const updatedSite = await getSite(siteId)
    if (updatedSite) setSite(updatedSite)
  }

  // Scoped refresh (track 020): after a mutation that only touches known
  // items, re-fetch just those rows (same include shape as getSite) and merge
  // them into the context — the full-site refresh was 5.8MB/~1.6s per rotate
  // click on the 4,436-item site, independent of parcel size.
  const refreshItems = async (itemIds: string[]) => {
    const fresh = await getInventoryItems(siteId, itemIds)
    if (!fresh) return refresh()
    const byId = new Map(fresh.map((i) => [i.id, i]))
    setSite({
      ...site,
      inventoryItems: (site.inventoryItems || []).map((i) => byId.get(i.id) ?? i),
    })
  }

  // ── Parcel tier (track 020 C2 slice 2) ────────────────────────────────
  // The payload carries ~12 ParcelSummary rows instead of thousands of seats.
  // Seats stream in per parcel and are merged into the SAME site context, so
  // every existing consumer below keeps reading `inventory` unchanged — a
  // parcel is simply absent from it until it has been opened.
  const parcels = site.parcels
  const loadedGroupsRef = useRef<Set<number>>(new Set())
  const [loadingGroups, setLoadingGroups] = useState(false)

  const ensureGroups = useCallback(async (groups: number[]) => {
    if (!parcels) return // no summaries → the full array is already present
    const missing = [...new Set(groups)].filter(
      (g) => g > 0 && !loadedGroupsRef.current.has(g),
    )
    if (missing.length === 0) return
    // Mark BEFORE awaiting so overlapping triggers (map idle + a click) cannot
    // issue the same fetch twice.
    for (const g of missing) loadedGroupsRef.current.add(g)
    setLoadingGroups(true)
    try {
      const rows = await getItemsByGroups(siteId, missing)
      if (!rows) {
        for (const g of missing) loadedGroupsRef.current.delete(g)
        return
      }
      setSite((prev: SiteProps) => {
        const existing = prev.inventoryItems || []
        const known = new Set(existing.map((i) => i.id))
        return { ...prev, inventoryItems: [...existing, ...rows.filter((r) => !known.has(r.id))] }
      })
    } catch {
      for (const g of missing) loadedGroupsRef.current.delete(g)
    } finally {
      setLoadingGroups(false)
    }
  }, [parcels, siteId, setSite])

  const sunbedEditing = useSunbedEditing(siteId, refresh)

  const isParcelEditorActive = editorMode === 'create-parcel' || editorMode === 'edit-parcel'

  // --- Summary stats ---
  const totalSunbeds = parcels
    ? parcels.reduce((sum, p) => sum + p.count, 0) + (site.ungroupedCount ?? 0)
    : inventory.length
  const totalParcels = parcels
    ? parcels.length
    : new Set(inventory.filter(i => i.group && i.group > 0).map(i => i.group)).size
  // Only ever computed over LOADED seats — a status roll-up over the whole
  // site would need its own aggregate, and this counter is advisory.
  const disabledCount = inventory.filter(i => i.status === 'disabled').length

  /** Seats in a parcel per the summary, falling back to the loaded array. */
  const parcelSeatCount = useCallback((group: number | null) => {
    if (!group) return 0
    const summary = parcels?.find((p) => p.group === group)
    if (summary) return summary.count
    return inventory.filter(i => i.group === group).length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels, site.inventoryItems])

  // --- Detect if all selected items belong to the same parcel group ---
  const selectedParcelGroupNumber = useMemo(() => {
    if (selectedItemIds.length < 2) return null
    const items = inventory.filter(i => selectedItemIds.includes(i.id))
    if (items.length === 0) return null
    const groups = new Set(items.map(i => i.group))
    if (groups.size !== 1) return null
    return items[0]!.group || null
  }, [selectedItemIds, inventory])

  // Total items in the selected parcel group
  const selectedParcelTotal = useMemo(
    () => parcelSeatCount(selectedParcelGroupNumber),
    [selectedParcelGroupNumber, parcelSeatCount],
  )

  // Whether ALL members of the parcel are in the selection
  const isCompleteParcelSelected = useMemo(() => {
    if (!selectedParcelGroupNumber) return false
    const totalInGroup = parcelSeatCount(selectedParcelGroupNumber)
    const selectedInGroup = inventory.filter(i =>
      i.group === selectedParcelGroupNumber && selectedItemIds.includes(i.id)
    ).length
    return totalInGroup > 0 && selectedInGroup === totalInGroup
  }, [selectedParcelGroupNumber, selectedItemIds, inventory, parcelSeatCount])

  // All existing parcel numbers for the assign dropdown
  const allParcelNumbers = useMemo(() => {
    if (parcels) return parcels.map((p) => p.group).sort((a, b) => a - b)
    const groups = new Set(inventory.filter(i => i.group && i.group > 0).map(i => i.group))
    return Array.from(groups).sort((a, b) => a - b)
  }, [inventory, parcels])

  const [selectedParcelConfig, setSelectedParcelConfig] = useState<ChairConfig | null>(null)

  useEffect(() => {
    if (!selectedParcelGroupNumber) {
      setSelectedParcelConfig(null)
      return
    }
    const groupItems = inventory.filter(i => i.group === selectedParcelGroupNumber)
    const firstWithGroup = groupItems.find(i => i.itemGroupId)
    if (firstWithGroup?.itemGroupId) {
      getItemGroup(firstWithGroup.itemGroupId).then(ig => {
        if (ig) {
          setSelectedParcelConfig({
            itemGroupId: ig.id,
            rows: Math.ceil(groupItems.length / ig.seatsPerRow),
            seatsPerRow: ig.seatsPerRow,
            horizontalGap: ig.horizontalGap,
            verticalGap: ig.verticalGap,
            rotation: ig.rotation,
            group: ig.number,
            category: ig.category || undefined,
            price: ig.price || undefined,
            pairSeats: ig.pairGap > 0,
            intraPairGap: ig.pairGap,
            baseLat: parseFloat(ig.locationLat),
            baseLng: parseFloat(ig.locationLng),
          })
        }
      })
    } else {
      const avgLat = groupItems.reduce((s, i) => s + Number(i.locationLat), 0) / groupItems.length
      const avgLng = groupItems.reduce((s, i) => s + Number(i.locationLng), 0) / groupItems.length
      setSelectedParcelConfig({
        rows: Math.ceil(groupItems.length / (parcelConfig.seatsPerRow || 4)),
        seatsPerRow: parcelConfig.seatsPerRow || 4,
        horizontalGap: parcelConfig.horizontalGap,
        verticalGap: parcelConfig.verticalGap,
        rotation: groupItems[0]?.rotation || 0,
        group: selectedParcelGroupNumber,
        pairSeats: true,
        intraPairGap: parcelConfig.intraPairGap,
        baseLat: avgLat,
        baseLng: avgLng,
      })
    }
  }, [selectedParcelGroupNumber])

  // --- Parcel handlers ---

  const handleParcelReorder = async () => {
    if (!selectedParcelConfig || !selectedParcelGroupNumber) return

    const groupItems = inventory.filter(i => i.group === selectedParcelGroupNumber)
    const firstWithGroup = groupItems.find(i => i.itemGroupId)
    let freshBaseLat = selectedParcelConfig.baseLat
    let freshBaseLng = selectedParcelConfig.baseLng
    if (firstWithGroup?.itemGroupId) {
      const ig = await getItemGroup(firstWithGroup.itemGroupId)
      if (ig) {
        freshBaseLat = parseFloat(ig.locationLat)
        freshBaseLng = parseFloat(ig.locationLng)
      }
    }
    const config = { ...selectedParcelConfig, baseLat: freshBaseLat, baseLng: freshBaseLng }
    await syncChairsWithLayout(siteId, config, 'rearrange')
    const updatedSite = await getSite(siteId)
    if (updatedSite) {
      setSite(updatedSite)
      const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === selectedParcelGroupNumber && i.status !== 'pool')
      setSelectedItemIds(updatedGroupItems.map((i: InventoryItem) => i.id))
    }
  }

  const handleEditParcelFull = () => {
    if (!selectedParcelConfig || !selectedParcelGroupNumber) return
    setParcelConfig(selectedParcelConfig)
    setEditGroup(selectedParcelGroupNumber)
    setEditorMode('edit-parcel')
    setSelectedItemId(null)
    setSelectedItemIds([])
  }

  // --- Selection operations ---

  const handleRotateSelected = async (delta: number) => {
    if (selectedItemIds.length === 0) return

    // Complete parcel: regenerate grid at new rotation (mirrors ParcelForm "Apply").
    if (isCompleteParcelSelected && selectedParcelGroupNumber) {
      const groupItems = inventory.filter(i => i.group === selectedParcelGroupNumber)
      const firstWithGroup = groupItems.find(i => i.itemGroupId)
      if (firstWithGroup?.itemGroupId) {
        const ig = await getItemGroup(firstWithGroup.itemGroupId)
        if (ig) {
          const newConfig: ChairConfig = {
            rows: Math.ceil(groupItems.length / ig.seatsPerRow),
            seatsPerRow: ig.seatsPerRow,
            horizontalGap: ig.horizontalGap,
            verticalGap: ig.verticalGap,
            rotation: ig.rotation + delta,
            group: ig.number,
            category: ig.category || undefined,
            price: ig.price || undefined,
            pairSeats: ig.pairGap > 0,
            intraPairGap: ig.pairGap,
            baseLat: parseFloat(ig.locationLat),
            baseLng: parseFloat(ig.locationLng),
          }
          await syncChairsWithLayout(siteId, newConfig, 'rearrange')
          await refreshItems(groupItems.map((i) => i.id))
          return
        }
      }
    }

    await rotateSelection(siteId, selectedItemIds, delta)
    await refreshItems(selectedItemIds)
  }

  const handleAdjustSpacing = async (axis: 'horizontal' | 'vertical', factor: number) => {
    if (selectedItemIds.length < 2) return
    await adjustItemSpacing(siteId, selectedItemIds, axis, factor)
    await refreshItems(selectedItemIds)
  }

  const handleAssignToParcel = async (group: number) => {
    if (selectedItemIds.length === 0) return
    await assignItemsToGroup(siteId, selectedItemIds, group)
    const updatedSite = await getSite(siteId)
    if (updatedSite) setSite(updatedSite)
  }

  const handleRemoveFromParcel = async () => {
    if (selectedItemIds.length === 0) return
    await removeItemsFromGroup(siteId, selectedItemIds)
    const updatedSite = await getSite(siteId)
    if (updatedSite) setSite(updatedSite)
  }

  // Parcel tier (track 020 C2 slice 2): the map can only hand us a GROUP when
  // that parcel's seats have not been fetched yet — load, then select.
  const handleOpenGroup = useCallback(async (group: number) => {
    await ensureGroups([group])
    const rows = await getItemsByGroups(siteId, [group])
    if (!rows) return
    setSelectedItemIds(rows.filter((i) => i.status !== 'pool').map((i) => i.id))
  }, [ensureGroups, siteId])

  const handleEnsureGroups = useCallback((groups: number[]) => {
    void ensureGroups(groups)
  }, [ensureGroups])

  // Summary-box drag: no seat is loaded, so the parcel moves by its ItemGroup
  // anchor — the same absolute-target rail, minus the anchor item.
  const handleMovedGroup = useCallback(async (group: number, targetLat: number, targetLng: number) => {
    await moveParcel(siteId, group, targetLat, targetLng)
    await refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId])

  const handleSelectEntireParcel = (group: number) => {
    const parcelItems = inventory.filter(i => i.group === group)
    if (parcelItems.length === 0 && parcels) {
      void handleOpenGroup(group)
      return
    }
    setSelectedItemIds(parcelItems.map(i => i.id))
  }

  const handleRestoreParcelOrder = async (group: number) => {
    const groupItems = inventory.filter(i => i.group === group)
    if (groupItems.length === 0) return

    const firstWithGroup = groupItems.find(i => i.itemGroupId)
    if (firstWithGroup?.itemGroupId) {
      const ig = await getItemGroup(firstWithGroup.itemGroupId)
      if (ig) {
        const config: ChairConfig = {
          itemGroupId: ig.id,
          rows: Math.ceil(groupItems.length / ig.seatsPerRow),
          seatsPerRow: ig.seatsPerRow,
          horizontalGap: ig.horizontalGap,
          verticalGap: ig.verticalGap,
          rotation: ig.rotation,
          group: ig.number,
          category: ig.category || undefined,
          price: ig.price || undefined,
          pairSeats: ig.pairGap > 0,
          intraPairGap: ig.pairGap,
          baseLat: parseFloat(ig.locationLat),
          baseLng: parseFloat(ig.locationLng),
        }
        await syncChairsWithLayout(siteId, config, 'rearrange')
        const updatedSite = await getSite(siteId)
        if (updatedSite) {
          setSite(updatedSite)
          const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === group && i.status !== 'pool')
          setSelectedItemIds(updatedGroupItems.map((i: InventoryItem) => i.id))
        }
        return
      }
    }

    // Fallback for parcels without an ItemGroup record
    const avgLat = groupItems.reduce((s, i) => s + Number(i.locationLat), 0) / groupItems.length
    const avgLng = groupItems.reduce((s, i) => s + Number(i.locationLng), 0) / groupItems.length
    const config: ChairConfig = {
      rows: Math.ceil(groupItems.length / (parcelConfig.seatsPerRow || 4)),
      seatsPerRow: parcelConfig.seatsPerRow || 4,
      horizontalGap: parcelConfig.horizontalGap,
      verticalGap: parcelConfig.verticalGap,
      rotation: groupItems[0]?.rotation || 0,
      group,
      pairSeats: true,
      intraPairGap: parcelConfig.intraPairGap,
      baseLat: avgLat,
      baseLng: avgLng,
    }
    await syncChairsWithLayout(siteId, config, 'rearrange')
    const updatedSite = await getSite(siteId)
    if (updatedSite) {
      setSite(updatedSite)
      const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === group && i.status !== 'pool')
      setSelectedItemIds(updatedGroupItems.map((i: InventoryItem) => i.id))
    }
  }

  // --- Escape key ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedItemIds([])
        setSelectedItemId(null)
        setEditorMode('none')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // --- Map / Marker handlers ---

  const handleMapClick = (e: MapMouseEvent) => {
    const lat = e?.detail.latLng?.lat
    const lng = e?.detail.latLng?.lng
    if (!lat || !lng) return

    // Move multi-selected items
    if (selectedItemIds.length > 0 && editorMode === 'none') {
      const selectedItems = inventory.filter(i => selectedItemIds.includes(i.id))
      if (selectedItems.length === 0) return
      const lats = selectedItems.map(i => Number(i.locationLat))
      const lngs = selectedItems.map(i => Number(i.locationLng))
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
      const deltaLat = lat - centerLat
      const deltaLng = lng - centerLng
      moveItems(siteId, selectedItemIds, deltaLat, deltaLng).then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
      })
      return
    }

    if (editorMode === 'create-parcel') {
      const newGroup = Math.max(0, ...allParcelNumbers, ...inventory.map(i => i.group || 0)) + 1
      const newConfig: ChairConfig = {
        ...parcelConfig,
        group: newGroup,
        baseLat: lat,
        baseLng: lng,
      }
      setParcelConfig(newConfig)
      syncChairsWithLayout(siteId, newConfig, 'create').then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) {
          setSite(updatedSite)
          const newItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === newGroup && i.status !== 'pool')
          setSelectedItemIds(newItems.map((i: InventoryItem) => i.id))
        }
        setEditorMode('none')
      })
      return
    }

    if (editorMode === 'edit-parcel') {
      setParcelConfig({ ...parcelConfig, baseLat: lat, baseLng: lng })
      // Absolute target for the ItemGroup anchor (no anchorItemId).
      moveParcel(siteId, parcelConfig.group, lat, lng).then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
      })
      return
    }

    if (editorMode === 'create-chair') {
      // Track 021 P2: one click places a UNIT (a pair by default), positioned
      // server-side in the same transaction — the old create-at-origin then
      // move-into-place round trip left a seat briefly on null island.
      createInventoryItem({
        siteId,
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      }).then(async (result) => {
        const newItem = result.item as InventoryItem
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
        setSelectedItemId(newItem.id)
        setEditorMode('edit-chair')
      })
      return
    }
  }

  const handleMarkerClick = (item: InventoryItem, modifiers?: { metaKey: boolean; ctrlKey: boolean }) => {
    // Ctrl/Cmd+click toggles item in multi-selection
    if (modifiers?.metaKey || modifiers?.ctrlKey) {
      setSelectedItemIds(prev => {
        if (prev.includes(item.id)) {
          return prev.filter(id => id !== item.id)
        }
        return [...prev, item.id]
      })
      setSelectedItemId(null)
      if (editorMode === 'edit-chair') setEditorMode('none')
      return
    }

    // Normal click: select the bed (show quick bar); panel stays closed
    const toggling = selectedItemId === item.id
    if (toggling) {
      setSelectedItemId(null)
      setItemPanelOpen(false)
      setEditorMode('none')
    } else {
      setSelectedItemId(item.id)
      setSelectedItemIds([])
      setEditorMode('edit-chair')
      // Do NOT open the panel here — operator uses the Edit button in the toolbar
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return
    // One set-based action — this was one server action PER SEAT, each with
    // its own site-wide label recompute (track 020).
    await deleteInventoryItems(siteId, selectedItemIds)
    setSelectedItemIds([])
    await refresh()
  }

  // --- Single-item toolbar handlers ---

  const handleRotateSingleItem = async (delta: number) => {
    if (!selectedItemId || !selectedItem) return
    // Group-first: collect other members of the same SunbedGroup from in-memory inventory.
    const partnerIds: string[] = selectedItem.sunbedGroupId
      ? inventory
          .filter((i) => i.sunbedGroupId === selectedItem.sunbedGroupId && i.id !== selectedItemId)
          .map((i) => i.id)
      : []
    // pairId fallback: for items not yet in a group, use the old pairId chain.
    if (partnerIds.length === 0) {
      const legacyPartnerId =
        selectedItem.pairId ??
        null
      if (legacyPartnerId) partnerIds.push(legacyPartnerId)
    }
    await sunbedEditing.rotateSingle(selectedItemId, selectedItem.rotation ?? 0, delta, partnerIds)
  }

  const handleDeleteSingleItem = async () => {
    if (!selectedItemId) return
    const idToDelete = selectedItemId
    setSelectedItemId(null)
    setItemPanelOpen(false)
    setEditorMode('none')
    await sunbedEditing.deleteSingle(idToDelete)
  }

  const handleMarkerDragEnd = (item: InventoryItem, e: any) => {
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    if (lat && lng) {
      if (item.group > 0) {
        // Absolute target: the dragged seat lands exactly where dropped — the
        // server computes the parcel delta from the seat's DB row, so a second
        // drag can't compound a stale client base (2026-08-15 drag-jump fix).
        moveParcel(siteId, item.group, lat, lng, item.id).then(() => {
          getSite(siteId).then((updatedSite) => {
            if (updatedSite) setSite(updatedSite)
          })
        })
      } else {
        saveInventoryItemLocation(item.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        }).then(() => {
          getSite(siteId).then((updatedSite) => {
            if (updatedSite) setSite(updatedSite)
          })
        })
      }
    }
  }

  const handleCancelParcel = () => {
    setEditorMode('none')
    setEditGroup(null)
  }

  const handleEditGroupFromForm = async (item: InventoryItem) => {
    const groupNumber = item.group || 1
    const allGroupItems = inventory.filter(i => i.group === groupNumber)
    const totalGroupItemCount = allGroupItems.length

    if (item.itemGroupId) {
      const itemGroup = await getItemGroup(item.itemGroupId)
      if (itemGroup) {
        let seatsPerRow = itemGroup.seatsPerRow
        let rows = Math.ceil(totalGroupItemCount / seatsPerRow)
        const existingConfig: ChairConfig = {
          itemGroupId: itemGroup.id,
          rows,
          seatsPerRow,
          horizontalGap: itemGroup.horizontalGap,
          verticalGap: itemGroup.verticalGap,
          rotation: itemGroup.rotation,
          group: itemGroup.number,
          category: itemGroup.category || undefined,
          price: itemGroup.price || undefined,
          pairSeats: true,
          intraPairGap: itemGroup.pairGap,
          baseLat: parseFloat(itemGroup.locationLat),
          baseLng: parseFloat(itemGroup.locationLng)
        }
        setParcelConfig(existingConfig)
        setEditGroup(itemGroup.number)
        setEditorMode('edit-parcel')
        setSelectedItemId(null)
        setItemPanelOpen(false)
        return
      }
    }

    const avgLat = allGroupItems.reduce((sum, i) => sum + parseFloat(i.locationLat!), 0) / allGroupItems.length
    const avgLng = allGroupItems.reduce((sum, i) => sum + parseFloat(i.locationLng!), 0) / allGroupItems.length
    const seatsPerRow = parcelConfig.seatsPerRow || 4
    const rows = Math.ceil(totalGroupItemCount / seatsPerRow)

    setParcelConfig(prev => ({
      ...prev,
      group: groupNumber,
      rows,
      seatsPerRow,
      baseLat: avgLat,
      baseLng: avgLng,
      rotation: allGroupItems[0]?.rotation || 0,
    }))

    setEditGroup(groupNumber)
    setEditorMode('edit-parcel')
    setSelectedItemId(null)
    setItemPanelOpen(false)
  }

  // --- Side panel visibility ---
  // InventoryForm opens only when the Edit button is pressed (itemPanelOpen),
  // not on every single click — matching the schematic editor's UX.
  const showItemPanel = !!selectedItem && editorMode === 'edit-chair' && itemPanelOpen
  const showParcelPanel = isParcelEditorActive
  const showPanel = showItemPanel || showParcelPanel

  return (
    <div className="flex flex-col -mt-2">
      {/* Summary strip */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{totalSunbeds}</span>
        <span>{t('sunbedsLabel', { count: totalSunbeds })}</span>
        <span className="text-gray-300">·</span>
        <span className="font-medium text-gray-700">{totalParcels}</span>
        <span>{t('parcelsLabel', { count: totalParcels })}</span>
        {disabledCount > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span className="font-medium text-amber-600">{disabledCount}</span>
            <span className="text-amber-600">{t('disabled')}</span>
          </>
        )}
      </div>

      {/* Readiness checklist */}
      <ReadinessChecklist
        site={site}
        onNavigate={(path) => router.push(path.startsWith('/') ? path : `/sites/${site.id}/${path}`)}
        className="mt-2 mb-0"
      />

      {/* Parcel list */}
      <ParcelList
        inventory={inventory}
        allParcelNumbers={allParcelNumbers}
        seatCountFor={parcelSeatCount}
        selectedItemIds={selectedItemIds}
        onSelectParcel={handleSelectEntireParcel}
        onRestoreOrder={handleRestoreParcelOrder}
      />

      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-gray-100 bg-white">
        <InventoryToolbar
          creating={editorMode === 'create-chair'}
          creatingParcel={editorMode === 'create-parcel'}
          selectedItemCount={selectedItemIds.length}
          selectedParcelGroup={selectedParcelGroupNumber}
          selectedParcelTotal={selectedParcelTotal}
          isCompleteParcelSelected={isCompleteParcelSelected}
          allParcelNumbers={allParcelNumbers}
          onClearSelection={() => {
            setSelectedItemIds([])
            setSelectedItemId(null)
            setItemPanelOpen(false)
            if (editorMode === 'edit-chair') setEditorMode('none')
          }}
          onDeleteSelected={handleDeleteSelected}
          onRotateSelected={handleRotateSelected}
          onAdjustSpacing={handleAdjustSpacing}
          onAssignToParcel={handleAssignToParcel}
          onRemoveFromParcel={handleRemoveFromParcel}
          onSelectEntireParcel={handleSelectEntireParcel}
          onParcelReorder={handleParcelReorder}
          onEditParcelFull={handleEditParcelFull}
          selectedSingleItemId={
            editorMode === 'edit-chair' && selectedItem ? selectedItem.id : null
          }
          selectedSingleItemNumber={selectedItem?.number ?? null}
          selectedSingleItemLabel={selectedItem?.seatLabel ?? null}
          selectedSingleItemParcelColor={
            selectedItem?.group ? getParcelColor(selectedItem.group) ?? null : null
          }
          // Track 021 P2: membership is UNIVERSAL now (every placed seat is in a
          // unit, often of one), so "has a pair" is a CARDINALITY question —
          // `!!sunbedGroupId` would be permanently true.
          selectedSingleItemHasPair={
            !!selectedItem?.sunbedGroupId &&
            inventory.filter((i) => i.sunbedGroupId === selectedItem.sunbedGroupId).length > 1
          }
          isEditPanelOpen={itemPanelOpen}
          onRotateSingle={handleRotateSingleItem}
          onEditSingle={() => setItemPanelOpen(prev => !prev)}
          onDeleteSingle={handleDeleteSingleItem}
          onStartCreate={() => {
            setEditorMode('create-chair')
            setSelectedItemId(null)
            setSelectedItemIds([])
          }}
          onStartParcel={() => {
            setEditorMode('create-parcel')
            setSelectedItemId(null)
            setSelectedItemIds([])
          }}
          onCancel={() => {
            setEditorMode('none')
            setSelectedItemId(null)
            setSelectedItemIds([])
          }}
        />
      </div>

      {/* Map + Side Panel */}
      <div className="relative" style={{ height: '600px' }}>
        {/* Map fills entire area */}
        <div className="absolute inset-0">
          <InventoryMap
            siteLat={siteLat}
            siteLng={siteLng}
            apiKey={apiKey}
            selectedItemId={selectedItemId}
            selectedItemIds={selectedItemIds}
            selectedGroupNumber={editGroup}
              creatingParcel={editorMode === 'create-parcel'}
            parcelSummary={editorMode === 'create-parcel' ? `${parcelConfig.rows} rows × ${parcelConfig.seatsPerRow} seats = ${parcelConfig.rows * parcelConfig.seatsPerRow} sunbeds` : undefined}
            repositionMode={(selectedParcelGroupNumber != null && editorMode === 'none') || editorMode === 'edit-parcel'}
            onMapClick={handleMapClick}
            onMarkerClick={handleMarkerClick}
            onMarkerDragEnd={handleMarkerDragEnd}
            onPlaceSelect={setSelectedPlace}
            onSelectionChange={setSelectedItemIds}
          onOpenGroup={handleOpenGroup}
          onEnsureGroups={handleEnsureGroups}
          onMovedGroup={handleMovedGroup}
            selectedPlace={selectedPlace}
          />
        </div>

        {/* Side panel overlay */}
        {showPanel && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-gray-200 shadow-lg z-10 flex flex-col">
            {showItemPanel && selectedItem && (
              <InventoryForm
                selectedItem={selectedItem}
                onDelete={() => {
                  setSelectedItemId(null)
                  setItemPanelOpen(false)
                  setEditorMode('none')
                  refresh()
                }}
                onEditGroup={handleEditGroupFromForm}
                onClose={() => {
                  setItemPanelOpen(false)
                }}
              />
            )}
            {showParcelPanel && (
              <ParcelForm
                mode={editorMode === 'edit-parcel' ? 'edit' : 'create'}
                siteId={siteId}
                editGroup={editGroup}
                config={parcelConfig}
                setConfig={setParcelConfig}
                onCancel={handleCancelParcel}
                onDeleteParcel={() => {
                  setEditorMode('none')
                  setEditGroup(null)
                  setSelectedItemId(null)
                }}
              />
            )}
          </div>
        )}
      </div>

      <div className="pb-8" />
    </div>
  )
}
