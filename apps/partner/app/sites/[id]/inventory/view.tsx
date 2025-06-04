'use client'

import React, { useState } from 'react'
import { InventoryItem } from '@/types/shared'
import { 
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties
} from '../actions'
import { useSite } from '@/app/sites/site-context'
import InventoryForm from './InventoryForm'
import InventoryMap from './InventoryMap'
import InventoryToolbar from './InventoryToolbar'
import Reservations from './reservations'
import { MapMouseEvent } from '@vis.gl/react-google-maps'

export default function InventoryView() {
  const { site, apiKey } = useSite()
  const inventory: InventoryItem[] = site.inventoryItems || []
  const siteId = site.id || ''
  const siteLat = site.locationLat
  const siteLng = site.locationLng

  // 1) “Creating new item” state
  const [creating, setCreating] = useState(false)

  // 2) Currently selected item’s ID (for editing/pairing)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((i) => i.id === selectedItemId)

  // 3) Editing form fields
  const [selectedItemNumber, setSelectedItemNumber] = useState('')
  const [selectedItemGroup, setSelectedItemGroup] = useState('')
  const [selectedItemLabel, setSelectedItemLabel] = useState('')
  const [selectedItemCategory, setSelectedItemCategory] = useState('')
  const [selectedItemPrice, setSelectedItemPrice] = useState('')
  const [selectedItemRotation, setSelectedItemRotation] = useState('')
  const [selectedItemPairId, setSelectedItemPairId] = useState('')
  const [pairingMode, setPairingMode] = useState(false)

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

  // 6) Field‐change helper
  const handleFieldChange = (field: string, value: string) => {
    switch (field) {
      case 'number': setSelectedItemNumber(value); break
      case 'group':  setSelectedItemGroup(value); break
      case 'label':  setSelectedItemLabel(value); break
      case 'category': setSelectedItemCategory(value); break
      case 'price':  setSelectedItemPrice(value); break
      case 'rotation': setSelectedItemRotation(value); break
      case 'pairId': setSelectedItemPairId(value); break
    }
  }

  // 7) “Save” / “Delete” / “Print” / “Pair” handlers
  const handleSave = () => {
    if (!selectedItem) return
    const changedValues: Record<string, any> = {}
    if (selectedItemNumber) changedValues.number = Number(selectedItemNumber)
    if (selectedItemGroup) changedValues.group = Number(selectedItemGroup)
    if (selectedItemLabel) changedValues.label = selectedItemLabel
    if (selectedItemCategory) changedValues.category = selectedItemCategory
    if (selectedItemPrice) changedValues.price = Number(selectedItemPrice)
    if (selectedItemRotation) changedValues.rotation = Number(selectedItemRotation)
    if (selectedItemPairId) changedValues.pairId = selectedItemPairId
    saveInventoryItemProperties(selectedItem.id, changedValues)
  }
  const handleDelete = () => {
    if (!selectedItem) return
    deleteInventoryItem(selectedItem.id)
    setSelectedItemId(null)
  }
  const handlePrint = () => {
    if (!selectedItem) return
    // QrPrintButton covers printing itself
  }
  const handlePair = () => {
    setPairingMode(true)
  }

  // 8) Click on “Add Item” banner and map‐click behavior
  const handleMapClick = (e: MapMouseEvent) => {

    console.log('click on map', e)
    const lat = e?.detail.latLng?.lat
    const lng = e?.detail.latLng?.lng
    if (!lat || !lng) return
  
    if (creating) {
      createInventoryItem({ siteId }).then(async (result) => {
        const newItem = result.item as InventoryItem
        setSelectedItemId(newItem.id)
        await saveInventoryItemLocation(newItem.id, {
          locationLat: lat.toString(),
          locationLng: lng.toString(),
        })
        setCreating(false)
      })
    } else if (selectedItem && !creating) {
      saveInventoryItemLocation(selectedItem.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }  

  // 9) Clicking a marker either selects or pairs
  const handleMarkerClick = (item: InventoryItem) => {
    if (pairingMode && selectedItem && item.id !== selectedItem.id) {
      setSelectedItemPairId(item.id)
      setPairingMode(false)
    } else {
      setSelectedItemPairId('')
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
        selectedItemId={selectedItemId}
        onStartCreate={handleStartCreate}
        onCancel={handleCancel}
        onPrintAll={handlePrintAll}
      />

      {selectedItem && !creating && (
        <InventoryForm
          siteId={siteId}
          selectedItem={selectedItem}
          selectedItemNumber={selectedItemNumber}
          selectedItemGroup={selectedItemGroup}
          selectedItemLabel={selectedItemLabel}
          selectedItemCategory={selectedItemCategory}
          selectedItemPrice={selectedItemPrice}
          selectedItemRotation={selectedItemRotation}
          selectedItemPairId={selectedItemPairId}
          onFieldChange={handleFieldChange}
          onSave={handleSave}
          onDelete={handleDelete}
          onPrint={handlePrint}
          onPair={handlePair}
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
          inventory={inventory}
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
