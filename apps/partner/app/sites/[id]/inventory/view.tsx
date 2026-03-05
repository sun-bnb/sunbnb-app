'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { InventoryItem } from '@/types/shared'
import {
  createInventoryItem,
  saveInventoryItemLocation,
  deleteInventoryItem,
} from '../inventory-actions'
import { getSite } from '../queries'
import { useSite } from '@/app/sites/site-context'
import { useSharedMap } from './SharedMapContext'
import InventoryForm from './InventoryForm'
import InventoryMap from './InventoryMap'
import InventoryToolbar from './InventoryToolbar'
import ParcelList from './ParcelList'
import ParcelForm from './ParcelForm'
import { MapMouseEvent } from '@vis.gl/react-google-maps'
import { ChairConfig } from './chair-util'
import { syncChairsWithLayout, getItemGroup, moveParcel, moveItems, rotateSelection, adjustItemSpacing, assignItemsToGroup, removeItemsFromGroup } from './actions'

export default function InventoryView() {

  const { site, setSite, apiKey } = useSite()
  const { setValue } = useSharedMap()

  const inventory: InventoryItem[] = site.inventoryItems || []
  const siteId = site.id || ''
  const siteLat = site.locationLat!
  const siteLng = site.locationLng!

  const [editorMode, setEditorMode] = useState<'none' | 'create-chair' | 'edit-chair' | 'create-parcel' | 'edit-parcel'>('none')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])

  const [editGroup, setEditGroup] = useState<number | null>(null)

  const [parcelConfig, setParcelConfig] = useState<ChairConfig>({
    rows: 2,
    seatsPerRow: 4,
    horizontalGap: 1,
    verticalGap: 1,
    rotation: 0,
    group: 1,
    category: 'PRICE1',
    price: 9,
    pairSeats: true,
    intraPairGap: 0.3,
    baseLat: Number(siteLat),
    baseLng: Number(siteLng),
  })

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  const [pairingMode, setPairingMode] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<any>(null)

  const isParcelEditorActive = editorMode === 'create-parcel' || editorMode === 'edit-parcel'

  // --- Summary stats ---
  const totalSunbeds = inventory.length
  const parcelGroups = new Set(inventory.filter(i => i.group && i.group > 0).map(i => i.group))
  const totalParcels = parcelGroups.size
  const disabledCount = inventory.filter(i => i.status === 'disabled').length

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
  const selectedParcelTotal = useMemo(() => {
    if (!selectedParcelGroupNumber) return 0
    return inventory.filter(i => i.group === selectedParcelGroupNumber).length
  }, [selectedParcelGroupNumber, inventory])

  // Whether ALL members of the parcel are in the selection
  const isCompleteParcelSelected = useMemo(() => {
    if (!selectedParcelGroupNumber) return false
    const totalInGroup = inventory.filter(i => i.group === selectedParcelGroupNumber).length
    const selectedInGroup = inventory.filter(i =>
      i.group === selectedParcelGroupNumber && selectedItemIds.includes(i.id)
    ).length
    return selectedInGroup === totalInGroup
  }, [selectedParcelGroupNumber, selectedItemIds, inventory])

  // All existing parcel numbers for the assign dropdown
  const allParcelNumbers = useMemo(() => {
    const groups = new Set(inventory.filter(i => i.group && i.group > 0).map(i => i.group))
    return Array.from(groups).sort((a, b) => a - b)
  }, [inventory])

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
      const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === selectedParcelGroupNumber)
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
    await rotateSelection(siteId, selectedItemIds, delta)
    const updatedSite = await getSite(siteId)
    if (updatedSite) setSite(updatedSite)
  }

  const handleAdjustSpacing = async (axis: 'horizontal' | 'vertical', factor: number) => {
    if (selectedItemIds.length < 2) return
    await adjustItemSpacing(siteId, selectedItemIds, axis, factor)
    const updatedSite = await getSite(siteId)
    if (updatedSite) setSite(updatedSite)
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

  const handleSelectEntireParcel = (group: number) => {
    const parcelItems = inventory.filter(i => i.group === group)
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
          const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === group)
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
      const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === group)
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
      const newGroup = Math.max(0, ...inventory.map(i => i.group || 0)) + 1
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
          const newItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === newGroup)
          setSelectedItemIds(newItems.map((i: InventoryItem) => i.id))
        }
        setEditorMode('none')
      })
      return
    }

    if (editorMode === 'edit-parcel') {
      const deltaLat = lat - parcelConfig.baseLat
      const deltaLng = lng - parcelConfig.baseLng
      setParcelConfig({ ...parcelConfig, baseLat: lat, baseLng: lng })
      moveParcel(siteId, parcelConfig.group, deltaLat, deltaLng).then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
      })
      return
    }

    if (editorMode === 'create-chair') {
      createInventoryItem({ siteId }).then(async (result) => {
        const newItem = result.item as InventoryItem
        await saveInventoryItemLocation(newItem.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        })
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

    // Normal click: single-select for editing
    if (pairingMode && selectedItem && item.id !== selectedItem.id) {
      setValue('selectedItemPairId', item.id)
      setPairingMode(false)
    } else {
      setValue('selectedItemPairId', '')
      setSelectedItemId(prev => (prev === item.id ? null : item.id))
      setSelectedItemIds([])
      setEditorMode('edit-chair')
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return
    await Promise.all(selectedItemIds.map(id => deleteInventoryItem(id)))
    setSelectedItemIds([])
    const updatedSite = await getSite(siteId)
    if (updatedSite) setSite(updatedSite)
  }

  const handleMarkerDragEnd = (item: InventoryItem, e: any) => {
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    if (lat && lng) {
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
  }

  // --- Side panel visibility ---
  const showItemPanel = !!selectedItem && editorMode === 'edit-chair'
  const showParcelPanel = isParcelEditorActive
  const showPanel = showItemPanel || showParcelPanel

  return (
    <div className="flex flex-col -mx-4 -mt-2">
      {/* Summary strip */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{totalSunbeds}</span>
        <span>sunbed{totalSunbeds !== 1 ? 's' : ''}</span>
        <span className="text-gray-300">·</span>
        <span className="font-medium text-gray-700">{totalParcels}</span>
        <span>parcel{totalParcels !== 1 ? 's' : ''}</span>
        {disabledCount > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span className="font-medium text-amber-600">{disabledCount}</span>
            <span className="text-amber-600">disabled</span>
          </>
        )}
      </div>

      {/* Parcel list */}
      <ParcelList
        inventory={inventory}
        allParcelNumbers={allParcelNumbers}
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
          onClearSelection={() => setSelectedItemIds([])}
          onDeleteSelected={handleDeleteSelected}
          onRotateSelected={handleRotateSelected}
          onAdjustSpacing={handleAdjustSpacing}
          onAssignToParcel={handleAssignToParcel}
          onRemoveFromParcel={handleRemoveFromParcel}
          onSelectEntireParcel={handleSelectEntireParcel}
          onParcelReorder={handleParcelReorder}
          onEditParcelFull={handleEditParcelFull}
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
            pairingMode={pairingMode}
            onMapClick={handleMapClick}
            onMarkerClick={handleMarkerClick}
            onMarkerDragEnd={handleMarkerDragEnd}
            onPlaceSelect={setSelectedPlace}
            onSelectionChange={setSelectedItemIds}
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
                  setEditorMode('none')
                  getSite(siteId).then((updatedSite) => {
                    if (updatedSite) setSite(updatedSite)
                  })
                }}
                onEditGroup={handleEditGroupFromForm}
                onClose={() => {
                  setSelectedItemId(null)
                  setEditorMode('none')
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
    </div>
  )
}
