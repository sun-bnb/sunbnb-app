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
import { syncChairsWithLayout, getItemGroup, saveBgOption, moveParcel } from './actions'

export default function InventoryView() {

  const { site, setSite, apiKey } = useSite()
  const { setValue, values } = useSharedMap()

  const inventory: InventoryItem[] = site.inventoryItems || []
  const siteId = site.id || ''
  const siteLat = site.locationLat!
  const siteLng = site.locationLng!

  const [deleteMode, setDeleteMode] = useState(false)
  const [editorMode, setEditorMode] = useState<'none' | 'create-chair' | 'edit-chair' | 'create-parcel' | 'edit-parcel'>('none')

  const [editGroup, setEditGroup] = useState<number | null>(null)
  const [parcelLatLng, setParcelLatLng] = useState<{ lat: number; lng: number } | null>(null)
  const [parcelMoveTrigger, setParcelMoveTrigger] = useState(0)


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

  
  const handleBgClick = (world: { x: number; y: number }, e: React.MouseEvent<SVGSVGElement>) => {
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
      setParcelLatLng({ lat, lng })
      setParcelConfig(newConfig)
      syncChairsWithLayout(siteId, newConfig, 'create').then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
        setEditorMode('none')
        setParcelLatLng(null)
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

    if (editorMode === 'create-parcel') {
      const newGroup = Math.max(0, ...inventory.map(i => i.group || 0)) + 1
      const newConfig: ChairConfig = {
        ...parcelConfig,
        group: newGroup,
        baseLat: lat,
        baseLng: lng,
      }
      setParcelLatLng({ lat, lng })
      setParcelConfig(newConfig)
      syncChairsWithLayout(siteId, newConfig, 'create').then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
        setEditorMode('none')
        setParcelLatLng(null)
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
    if (deleteMode) {
      deleteInventoryItem(item.id)
      getSite(siteId).then((updatedSite) => {
        if (updatedSite) setSite(updatedSite)
      })
      return
    }

    if (pairingMode && selectedItem && item.id !== selectedItem.id) {
      setValue('selectedItemPairId', item.id)
      setPairingMode(false)
    } else {
      setValue('selectedItemPairId', '')
      setSelectedItemId(prev => (prev === item.id ? null : item.id))
      setEditorMode('edit-chair')
    }
  }

  const handleMarkerDragEnd = (item: InventoryItem, e: any) => {
    
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    console.log('Marker drag ended for item:', lat, lng)
    if (lat && lng) {
      saveInventoryItemLocation(item.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }

  const handleCancelParcel = () => {
    setEditorMode('none')
    setEditGroup(null)
    setParcelLatLng(null)
  }

  console.log('bgOptuon', bgOption)

  const svg = useSvgFromUrl(site.bgImageUrl || null)

  return (
    <div className="container mx-auto p-4">
      <InventoryToolbar
        creating={editorMode === 'create-chair'}
        creatingParcel={editorMode === 'create-parcel'}
        selectedItemId={selectedItemId}
        deleteMode={deleteMode}
        onToggleDeleteMode={() => setDeleteMode(prev => !prev)}
        onStartCreate={() => {
          setEditorMode('create-chair')
          setSelectedItemId(null)
        }}
        onStartParcel={() => {
          setEditorMode('create-parcel')
          setSelectedItemId(null)
        }}
        onCancel={() => {
          setEditorMode('none')
          setSelectedItemId(null)
        }}
        onPrintAll={() => {}}
      />

      {isParcelEditorActive && (
        <ParcelForm
          mode={editorMode === 'edit-parcel' ? 'edit' : 'create'}
          siteId={siteId}
          editGroup={editGroup}
          config={parcelConfig}
          setConfig={setParcelConfig}
          moveTrigger={parcelMoveTrigger}
          onCancel={handleCancelParcel}
          onDeleteParcel={(group) => {
            setEditorMode('none')
            setEditGroup(null)
            setParcelLatLng(null)
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

            console.log('Edit group for item:', item)

            // Count ALL items in this group from the client-side inventory,
            // regardless of whether they have an itemGroupId or not.
            const groupNumber = item.group || 1
            const allGroupItems = inventory.filter(i => i.group === groupNumber)
            const totalGroupItemCount = allGroupItems.length

            if (item.itemGroupId) {
              const itemGroup = await getItemGroup(item.itemGroupId)
              console.log('Group', itemGroup)
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
                setParcelLatLng({ lat: parseFloat(itemGroup.locationLat), lng: parseFloat(itemGroup.locationLng) })
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

            setParcelLatLng({ lat: avgLat, lng: avgLng })
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
                saveBgOption(siteId, newMode).then(async () => {
                  console.log('Saved background option:', newMode);
                })
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
              selectedGroupNumber={editGroup}
              pairingMode={pairingMode}
              onMapClick={handleMapClick}
              onMarkerClick={handleMarkerClick}
              onMarkerDragEnd={handleMarkerDragEnd}
              onPlaceSelect={setSelectedPlace}
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
