'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { InventoryItem } from '@/types/shared'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import {
  createInventoryItem,
  saveInventoryItemLocation,
  deleteInventoryItem,
  getSite,
} from '../actions'
import { useSite } from '@/app/sites/site-context'
import { useSharedMap } from './SharedMapContext'
import InventoryForm from './InventoryForm'
import InventoryMap from './InventoryMap'
import InventoryBackground from './InventoryBackground'
import InventoryToolbar from './InventoryToolbar'
import Reservations from './reservations'
import BackgroundUploader from './BackgroundUploader'
import ParcelForm from './ParcelForm'
import { MapMouseEvent } from '@vis.gl/react-google-maps'
import { ChairConfig } from './chair-util'
import { makeLocalProjector } from './map-geo'
import { syncChairsWithLayout, getItemGroup, saveBgOption, moveParcel, moveItems } from './actions'

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

  const proj = useMemo(
    () => makeLocalProjector({
      lat: Number(site.locationLat),
      lng: Number(site.locationLng),
    }),
    [site.locationLat, site.locationLng]
  )

  const [parcelConfig, setParcelConfig] = useState<ChairConfig>({
    rows: 2,
    seatsPerRow: 4,
    horizontalGap: 1.2,
    verticalGap: 4.5,
    rotation: 0,
    group: 1,
    category: 'PRICE1',
    price: 9,
    pairSeats: true,
    intraPairGap: 1,
    baseLat: Number(siteLat),
    baseLng: Number(siteLng),
  })

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  const [pairingMode, setPairingMode] = useState(false)
  const [bgOption, setBgOption] = useState<string>(site.background || 'map')
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  const isParcelEditorActive = editorMode === 'create-parcel' || editorMode === 'edit-parcel'

  // Detect if all selected items belong to the same parcel group
  const selectedParcelGroupNumber = useMemo(() => {
    if (selectedItemIds.length < 2) return null
    const items = inventory.filter(i => selectedItemIds.includes(i.id))
    if (items.length === 0) return null
    const groups = new Set(items.map(i => i.group))
    if (groups.size !== 1) return null
    return items[0]!.group || null
  }, [selectedItemIds, inventory])

  // Load parcel config when a single-group selection is detected
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
      // Derive from items
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

  // Quick-adjust parcel property from toolbar (rotate, spacing, etc.)
  const handleParcelAdjust = async (field: keyof ChairConfig, delta: number) => {
    if (!selectedParcelConfig || !selectedParcelGroupNumber) return

    // Reload the ItemGroup anchor fresh from the DB — this is the true
    // generation origin (position of seat row=0, col=0) and is kept in
    // sync by moveItems / moveParcel.
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

    const newVal = (selectedParcelConfig[field] as number) + delta
    const newConfig = { ...selectedParcelConfig, baseLat: freshBaseLat, baseLng: freshBaseLng, [field]: newVal }
    setSelectedParcelConfig(newConfig)
    await syncChairsWithLayout(siteId, newConfig, 'rearrange')
    const updatedSite = await getSite(siteId)
    if (updatedSite) {
      setSite(updatedSite)
      const updatedGroupItems = (updatedSite.inventoryItems || []).filter((i: InventoryItem) => i.group === selectedParcelGroupNumber)
      setSelectedItemIds(updatedGroupItems.map((i: InventoryItem) => i.id))
    }
  }

  // Snap all chairs back to their grid positions using current config
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

  // Open the full ParcelForm for detailed editing
  const handleEditParcelFull = () => {
    if (!selectedParcelConfig || !selectedParcelGroupNumber) return
    setParcelConfig(selectedParcelConfig)
    setEditGroup(selectedParcelGroupNumber)
    setEditorMode('edit-parcel')
    setSelectedItemId(null)
    setSelectedItemIds([])
  }

  // Escape key clears multi-selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedItemIds([])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function useSvgFromUrl(url: string | null) {
    const [data, setData] = useState<{ inner: string; viewBox: string }>()
    useEffect(() => {
      let cancel = false
      ;(async () => {
        if (!url) return null
        const res = await fetch(url, { cache: 'force-cache' })
        const text = await res.text()
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
        const svg = doc.querySelector('svg')
        const viewBox =
          svg?.getAttribute('viewBox') ||
          `0 0 ${svg?.getAttribute('width') || 1000} ${svg?.getAttribute('height') || 700}`
        const inner = svg ? svg.innerHTML : text
        if (!cancel) setData({ inner, viewBox })
      })()
      return () => { cancel = true }
    }, [url])
    return data
  }

  
  const handleBgClick = (world: { x: number; y: number }) => {
    const { lat, lng } = proj.worldToLl(world.x, world.y) // respects inverted Y
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

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
        setSelectedItemId(newItem.id)
        await saveInventoryItemLocation(newItem.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        })
        setEditorMode('none')
      })
      return
    }
  }

  const handleMapClick = (e: MapMouseEvent) => {
    const lat = e?.detail.latLng?.lat
    const lng = e?.detail.latLng?.lng
    if (!lat || !lng) return

    // If items are multi-selected, clicking the map moves them to the clicked location
    if (selectedItemIds.length > 0 && editorMode === 'none') {
      const selectedItems = inventory.filter(i => selectedItemIds.includes(i.id))
      if (selectedItems.length === 0) return
      // Anchor = center of bounding box
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
        setSelectedItemId(newItem.id)
        await saveInventoryItemLocation(newItem.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        })
        setEditorMode('none')
      })
      return
    }

  }

  const handleMarkerClick = (item: InventoryItem) => {
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

  const svg = useSvgFromUrl(site.bgImageUrl || null)

  return (
    <div className="container mx-auto p-4">
      <InventoryToolbar
        creating={editorMode === 'create-chair'}
        creatingParcel={editorMode === 'create-parcel'}
        selectedItemId={selectedItemId}
        selectedItemCount={selectedItemIds.length}
        parcelConfig={selectedParcelConfig}
        onClearSelection={() => setSelectedItemIds([])}
        onDeleteSelected={handleDeleteSelected}
        onParcelAdjust={handleParcelAdjust}
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

      {isParcelEditorActive && (
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

      {selectedItem && editorMode === 'edit-chair' && (
        <InventoryForm
          selectedItem={selectedItem}
          onSave={() => {}}
          onDelete={() => {
            setSelectedItemId(null)
            getSite(siteId).then((updatedSite) => {
              if (updatedSite) setSite(updatedSite)
            })
          }}
          onPair={() => setPairingMode(true)}
          onEditGroup={async (item: InventoryItem) => {
            // Count ALL items in this group from the client-side inventory,
            // regardless of whether they have an itemGroupId or not.
            const groupNumber = item.group || 1
            const allGroupItems = inventory.filter(i => i.group === groupNumber)
            const totalGroupItemCount = allGroupItems.length

            if (item.itemGroupId) {
              const itemGroup = await getItemGroup(item.itemGroupId)
              if (itemGroup) {
                // Derive rows & seatsPerRow so the entire parcel is covered,
                // not just the (possibly stale) values stored on the ItemGroup.
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

            // Derive rows from the actual number of items in the group
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
          }}
        />
      )}

      <div className="mt-6 flex flex-col">
        {selectedItem && Number(selectedItem.locationLat) === 0 && editorMode === 'edit-chair' && (
          <div className="w-full bg-yellow-400 p-2 text-gray-600 font-bold">
            Place item on the map:
          </div>
        )}
        {
          editorMode === 'create-chair' && (
            <div className="w-full bg-green-200 p-2 text-gray-800 font-bold">
              Click on the map to place the new item
            </div>
          )
        }
        {
          editorMode === 'create-parcel' && (
            <div className="w-full bg-green-200 p-2 text-gray-800 font-bold">
              Click on the map to place the new parcel
            </div>
          )
        }

        <div className="flex justify-between mb-1">
          {
            bgOption === 'background' ?
              <BackgroundUploader siteId={site.id!} /> : <div></div>
          }
          <ToggleButtonGroup
            value={bgOption}
            exclusive
            onChange={(
              _event: React.MouseEvent<HTMLElement>,
              newMode: 'map' | 'background' | null
            ) => {
              if (newMode !== null) {
                setBgOption(newMode);
                saveBgOption(siteId, newMode)
              }
            }}
            aria-label="mode toggle"
          >
            <ToggleButton value="map" aria-label="map">
              MAP
            </ToggleButton>
            <ToggleButton value="background" aria-label="background">
              BACKGROUND
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
        {
          bgOption === 'background' && site.bgImageUrl ?
            <InventoryBackground 
              backgroundSvg={svg?.inner || ''}
              selectedItemId={selectedItemId}
              selectedGroupNumber={editGroup}
              pairingMode={pairingMode}
              onMapClick={handleBgClick}
              onMarkerClick={handleMarkerClick}
              onMarkerDragEnd={handleMarkerDragEnd} /> : 
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
        }
        
        <div className="w-full mt-4 text-sm md:text-base">
          {selectedItem && <Reservations reservations={selectedItem.reservations || []} />}
        </div>
      </div>
    </div>
  )
}
