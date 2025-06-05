'use client'

import React, { useState } from 'react'
import { InventoryItem } from '@/types/shared'
import { 
  createInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties,
  deleteInventoryItem
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

  const [editingParcel, setEditingParcel] = useState(false)
  const [editParcelMode, setEditParcelMode] = useState<'create' | 'edit'>('create')
  const [editGroup, setEditGroup] = useState<number | null>(null)
  const [clickedLatLng, setClickedLatLng] = useState<{ lat: number; lng: number } | null>(null)

  const [creating, setCreating] = useState(false)
  const [pairingMode, setPairingMode] = useState(false)

  // 2) Currently selected item’s ID (for editing/pairing)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  // 4) Map state: zoom, place-selection
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  // 5) Toolbar handlers
  const handleStartCreate = () => {
    setCreating(true)
    setSelectedItemId(null)
  }
  const handleCancel = () => {
    setCreating(false)
    setSelectedItemId(null)
  }
  const handlePrintAll = () => {
    // Pass all items to the QrPrintButton if needed
  }

  const handleMapClick = (e: MapMouseEvent) => {
    const lat = e?.detail.latLng?.lat
    const lng = e?.detail.latLng?.lng
    if (!lat || !lng) return
  
    if (editingParcel) {
      setClickedLatLng({ lat, lng })
    } else if (creating) {
      createInventoryItem({ siteId }).then(async (result) => {
        const newItem = result.item as InventoryItem
        setSelectedItemId(newItem.id)
        await saveInventoryItemLocation(newItem.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        })
        setCreating(false)
      })
    } else if (selectedItem) {
      saveInventoryItemLocation(selectedItem.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }
  

  // 9) Clicking a marker either selects or pairs
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
      setCreating(false)
    }
  }

  // 10) Dragging a marker
  const handleMarkerDragEnd = (item: InventoryItem, e: any) => {
    const lat = e.latLng?.lat()
    const lng = e.latLng?.lng()
    if (!creating && lat && lng) {
      saveInventoryItemLocation(item.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }

  return (
    <div className="container mx-auto p-4">
      
      <InventoryToolbar
        creating={creating}
        creatingParcel={editingParcel}
        selectedItemId={selectedItemId}
        deleteMode={deleteMode}
        onToggleDeleteMode={() => setDeleteMode((prev) => !prev)}
        onStartCreate={() => {
          setCreating(true)
          setEditingParcel(false)
          setSelectedItemId(null)
        }}
        onStartParcel={() => {
          setCreating(true)
          setEditParcelMode('create')
          setEditingParcel(true)
          setSelectedItemId(null)
        }}
        onCancel={handleCancel}
        onPrintAll={handlePrintAll}
      />

        {creating && editingParcel && clickedLatLng && (
          <ParcelForm
            mode={editParcelMode}
            siteId={siteId}
            editGroup={editGroup}
            initialLat={clickedLatLng.lat}
            initialLng={clickedLatLng.lng}
            onCancel={handleCancel}
            onPlace={async (items) => {

              const createdItems: Record<string, InventoryItem> = {}

              // 1. First pass: create items and store mapping from pair label → database item
              for (const item of items) {
                const result = await createInventoryItem({ siteId })
                const newItem = result.item as InventoryItem

                await saveInventoryItemLocation(newItem.id, {
                  locationLat: item.locationLat,
                  locationLng: item.locationLng,
                })

                await saveInventoryItemProperties(newItem.id, {
                  rotation: item.rotation,
                  number: item.number,
                  group: item.group,
                })

                // Store in map by label for later pairing
                createdItems[item.tempId] = newItem
              }

              // 2. Second pass: update pairId now that we have all real database IDs
              for (const item of items) {
                if (item.pairTempId) {
                  const current = createdItems[item.tempId]
                  const pair = createdItems[item.pairTempId]
                  if (current && pair) {
                    await saveInventoryItemProperties(current.id, {
                      pairId: pair.id,
                    })
                  }
                }
              }

              setCreating(false)
              setEditingParcel(false)
              setClickedLatLng(null)
            }}
            onDeleteParcel={(group) => {
              setCreating(false)
              setEditingParcel(false)
              setSelectedItemId(null)
              setClickedLatLng(null)
              
            }}
          />
        )}


        {selectedItem && !creating && (
          <InventoryForm
            selectedItem={selectedItem}
            onSave={() => {
              console.log('Item saved')
            }}
            onDelete={() => {
              setSelectedItemId(null)
            }}
            onPair={() => {
              setPairingMode(true)
            }}
            onEditGroup={(groupNumber: number) => {
              setEditGroup(groupNumber)
              setEditParcelMode('edit')
              setEditingParcel(true)
              setCreating(true)
            }}
          />
        )}

        <div className="mt-6 flex flex-col">
          {selectedItem && Number(selectedItem.locationLat) === 0 && !creating && (
            <div className="w-full bg-yellow-400 p-2 text-gray-600 font-bold">
              Place item on the map:
            </div>
          )}
          {creating && (
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
