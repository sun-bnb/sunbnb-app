'use client'

import React, { useState } from 'react'
import { InventoryItem } from '@/types/shared'
import {
  createInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties,
  deleteInventoryItem,
} from '../actions'
import { useSite } from '@/app/sites/site-context'
import { useSharedMap } from './SharedMapContext'
import InventoryForm from './InventoryForm'
import InventoryMap from './InventoryMap'
import InventoryToolbar from './InventoryToolbar'
import Reservations from './reservations'
import ParcelForm from './ParcelForm'
import { MapMouseEvent } from '@vis.gl/react-google-maps'

export default function InventoryView() {
  const { site, nonce, apiKey } = useSite()
  const { setValue, values } = useSharedMap()

  const inventory: InventoryItem[] = site.inventoryItems || []

  const siteId = site.id || ''
  const siteLat = site.locationLat
  const siteLng = site.locationLng

  const [deleteMode, setDeleteMode] = useState(false)

  const [parcelMode, setParcelMode] = useState<'none' | 'create' | 'edit'>('none')
  const [editGroup, setEditGroup] = useState<number | null>(null)
  const [parcelLatLng, setParcelLatLng] = useState<{ lat: number; lng: number } | null>(null)

  const [creatingChair, setCreatingChair] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  const [pairingMode, setPairingMode] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  const handleMapClick = (e: MapMouseEvent) => {
    const lat = e?.detail.latLng?.lat
    const lng = e?.detail.latLng?.lng
    if (!lat || !lng) return

    if (parcelMode !== 'none') {
      // Always move parcel when parcel editor is active
      setParcelLatLng({ lat, lng })
    } else if (creatingChair) {
      createInventoryItem({ siteId }).then(async (result) => {
        const newItem = result.item as InventoryItem
        setSelectedItemId(newItem.id)
        await saveInventoryItemLocation(newItem.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        })
        setCreatingChair(false)
      })
    } else if (selectedItem) {
      saveInventoryItemLocation(selectedItem.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }

  const handleMarkerClick = (item: InventoryItem) => {
    if (deleteMode) {
      deleteInventoryItem(item.id)
      return
    }

    if (pairingMode && selectedItem && item.id !== selectedItem.id) {
      setValue('selectedItemPairId', item.id)
      setPairingMode(false)
    } else {
      setValue('selectedItemPairId', '')
      setSelectedItemId((prev) => (prev === item.id ? null : item.id))
      setCreatingChair(false)
      setParcelMode('none')
    }
  }

  const handleMarkerDragEnd = (item: InventoryItem, e: any) => {
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    if (!creatingChair && lat && lng) {
      saveInventoryItemLocation(item.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }

  const handleCancelParcel = () => {
    setParcelMode('none')
    setEditGroup(null)
    setParcelLatLng(null)
  }

  return (
    <div className="container mx-auto p-4">
      <InventoryToolbar
        creating={creatingChair}
        creatingParcel={parcelMode !== 'none'}
        selectedItemId={selectedItemId}
        deleteMode={deleteMode}
        onToggleDeleteMode={() => setDeleteMode((prev) => !prev)}
        onStartCreate={() => {
          setCreatingChair(true)
          setParcelMode('none')
          setSelectedItemId(null)
        }}
        onStartParcel={() => {
          setCreatingChair(true)
          setParcelMode('create')
          setSelectedItemId(null)
        }}
        onCancel={() => {
          setCreatingChair(false)
          setSelectedItemId(null)
          setParcelMode('none')
        }}
        onPrintAll={() => {}}
      />

      {parcelMode !== 'none' && parcelLatLng && (
        <ParcelForm
          mode={parcelMode}
          siteId={siteId}
          editGroup={editGroup}
          initialLat={parcelLatLng.lat}
          initialLng={parcelLatLng.lng}
          onCancel={handleCancelParcel}
          onPlace={() => {
            setCreatingChair(false)
            setParcelMode('none')
            setParcelLatLng(null)
          }}
          onDeleteParcel={(group) => {
            setCreatingChair(false)
            setParcelMode('none')
            setEditGroup(null)
            setParcelLatLng(null)
            setSelectedItemId(null)
          }}
        />
      )}

      {selectedItem && parcelMode === 'none' && !creatingChair && (
        <InventoryForm
          selectedItem={selectedItem}
          onSave={() => {}}
          onDelete={() => setSelectedItemId(null)}
          onPair={() => setPairingMode(true)}
          onEditGroup={(groupNumber: number) => {
            setEditGroup(groupNumber)
            setParcelMode('edit')
            setCreatingChair(false)
            setSelectedItemId(null)

            // Immediately set parcel location using the average of group items
            const groupItems = inventory.filter((i) => i.group === groupNumber)
            const avgLat = groupItems.reduce((sum, i) => sum + parseFloat(i.locationLat!), 0) / groupItems.length
            const avgLng = groupItems.reduce((sum, i) => sum + parseFloat(i.locationLng!), 0) / groupItems.length
            setParcelLatLng({ lat: avgLat, lng: avgLng })
          }}
        />
      )}

      <div className="mt-6 flex flex-col">
        {selectedItem && Number(selectedItem.locationLat) === 0 && !creatingChair && (
          <div className="w-full bg-yellow-400 p-2 text-gray-600 font-bold">
            Place item on the map:
          </div>
        )}
        {creatingChair && parcelMode === 'none' && (
          <div className="w-full bg-green-200 p-2 text-gray-800 font-bold">
            Click on the map to place the new item
          </div>
        )}
        <InventoryMap
          siteLat={siteLat!}
          siteLng={siteLng!}
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
