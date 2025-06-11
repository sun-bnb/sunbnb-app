'use client'

import React, { useState } from 'react'
import { InventoryItem } from '@/types/shared'
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
import InventoryToolbar from './InventoryToolbar'
import Reservations from './reservations'
import ParcelForm from './ParcelForm'
import { MapMouseEvent } from '@vis.gl/react-google-maps'
import { ChairConfig } from './chair-util'
import { syncChairsWithLayout } from './actions'

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

  const [parcelConfig, setParcelConfig] = useState<ChairConfig>({
    rows: 2,
    seatsPerRow: 4,
    horizontalGap: 0.4,
    verticalGap: 4.5,
    rotation: 0,
    group: 1,
    pairSeats: true,
    intraPairGap: 1.6,
    baseLat: Number(siteLat),
    baseLng: Number(siteLng),
  })

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  const [pairingMode, setPairingMode] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  const isParcelEditorActive = editorMode === 'create-parcel' || editorMode === 'edit-parcel'

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
      setParcelConfig({ ...parcelConfig, baseLat: lat, baseLng: lng })
      setParcelMoveTrigger(Date.now())
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
          onEditGroup={(groupNumber: number) => {
            const groupItems = inventory.filter(i => i.group === groupNumber)
            const avgLat = groupItems.reduce((sum, i) => sum + parseFloat(i.locationLat!), 0) / groupItems.length
            const avgLng = groupItems.reduce((sum, i) => sum + parseFloat(i.locationLng!), 0) / groupItems.length

            setParcelConfig(prev => ({
              ...prev,
              group: groupNumber,
              baseLat: avgLat,
              baseLng: avgLng,
              rotation: groupItems[0]?.rotation || 0,
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
        {editorMode === 'create-chair' && (
          <div className="w-full bg-green-200 p-2 text-gray-800 font-bold">
            Click on the map to place the new item
          </div>
        )}
        <InventoryMap
          siteLat={siteLat}
          siteLng={siteLng}
          apiKey={apiKey}
          selectedItemId={selectedItemId}
          pairingMode={pairingMode}
          onMapClick={handleMapClick}
          onMarkerClick={handleMarkerClick}
          onMarkerDragEnd={handleMarkerDragEnd}
          onPlaceSelect={setSelectedPlace}
          selectedPlace={selectedPlace}
        />
        <div className="w-full mt-4 text-sm md:text-base">
          {selectedItem && <Reservations reservations={selectedItem.reservations || []} />}
        </div>
      </div>
    </div>
  )
}
