'use client'

import Image from 'next/image'
import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import CancelIcon from '@mui/icons-material/Cancel'
import CloseIcon from '@mui/icons-material/Close'
import { InventoryItem } from '../../../../types/shared'
import { 
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties
} from '../actions'
import { useSite } from '@/app/sites/site-context'
import { APIProvider, AdvancedMarker, ControlPosition, Map } from '@vis.gl/react-google-maps'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import Reservations from './reservations'
import sunbedIcon from './sunbed-icon-transparent.png'
import QrPrintButton from './qr-print-button'

function getScaledSize(zoom: number): number {
  const physicalLength = 3.5 // meters
  const metersPerPixel = 156543.03392 / Math.pow(2, zoom)
  return physicalLength / metersPerPixel
}

interface SunbedMarkerProps {
  item: InventoryItem
  dynamicSize: number
  zoom: number
  selected?: boolean
  pairedSelected?: boolean
  onClick: () => void
  onDragEnd: (e: any) => void
}

const SunbedMarker: React.FC<SunbedMarkerProps> = ({
  item,
  dynamicSize,
  zoom,
  selected = false,
  pairedSelected = false,
  onClick,
  onDragEnd,
}) => {
  const width = dynamicSize * 0.5
  const height = dynamicSize
  const isPaired = Boolean(item.pairId || item.pairedBy?.id)
  const borderThickness = (selected || pairedSelected) ? 4 : 2
  const borderColor = isPaired ? 'gray' : 'black'
  const rotation = item.rotation || 0

  const markerContent = (
    <div
      className="relative"
      style={{
        height: `${dynamicSize}px`,
        width: `${dynamicSize / 2.5}px`,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          border: `${borderThickness}px solid ${borderColor}`,
          borderRadius: '4px',
          backgroundColor: selected ? 'rgba(0, 0, 0, 0.3)' : 'transparent',
        }}
      />
      {zoom > 20 && (
        <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full px-1">
          {String(item.number).padStart(4, '0')}
        </div>
      )}
    </div>
  )

  return (
    <AdvancedMarker
      position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
      draggable
      onClick={onClick}
      onDragEnd={onDragEnd}
    >
      {markerContent}
    </AdvancedMarker>
  )
}

interface InventoryFormProps {
  siteId: string
  selectedItem: InventoryItem
  selectedItemNumber: string
  selectedItemGroup: string
  selectedItemLabel: string
  selectedItemCategory: string
  selectedItemPrice: string
  selectedItemRotation: string
  selectedItemPairId: string
  onFieldChange: (
    field: 'number' | 'group' | 'label' | 'category' | 'price' | 'rotation' | 'pairId',
    value: string
  ) => void
  onSave: () => void
  onDelete: () => void
  onPrint: () => void
  onPair: () => void
}

const InventoryForm: React.FC<InventoryFormProps> = ({
  siteId,
  selectedItem,
  selectedItemNumber,
  selectedItemGroup,
  selectedItemLabel,
  selectedItemCategory,
  selectedItemPrice,
  selectedItemRotation,
  selectedItemPairId,
  onFieldChange,
  onSave,
  onDelete,
  onPrint,
  onPair,
}) => (
  <div className="flex flex-col mt-[6px] ml-[4px]">
    <div className="flex mb-2">
      <TextField
        name="item-number"
        label="Item Number"
        fullWidth
        value={selectedItemNumber || String(selectedItem.number) || ''}
        variant="standard"
        placeholder="0001"
        onChange={(e) => onFieldChange('number', e.target.value)}
        sx={{ mr: 1 }}
      />
      <TextField
        name="item-group"
        label="Item Group"
        fullWidth
        value={selectedItemGroup || String(selectedItem.group) || ''}
        variant="standard"
        placeholder="0"
        onChange={(e) => onFieldChange('group', e.target.value)}
        sx={{ mr: 1 }}
      />
      <TextField
        name="item-label"
        label="Item Label"
        fullWidth
        value={selectedItemLabel || selectedItem.label || ''}
        variant="standard"
        placeholder="Sunbed A"
        onChange={(e) => onFieldChange('label', e.target.value)}
        sx={{ mr: 1 }}
      />
    </div>
    <div className="flex mb-2">
      <TextField
        name="item-category"
        label="Item Category"
        fullWidth
        value={selectedItemCategory || selectedItem.category || ''}
        variant="standard"
        placeholder="PRICE1"
        onChange={(e) => onFieldChange('category', e.target.value)}
        sx={{ mr: 1 }}
      />
      <TextField
        name="item-price"
        label="Item Price"
        fullWidth
        value={selectedItemPrice || selectedItem.price?.toString() || ''}
        variant="standard"
        placeholder="8.5"
        onChange={(e) => onFieldChange('price', e.target.value)}
        sx={{ mr: 1 }}
      />
    </div>
    <div className="flex mb-2">
      <TextField
        name="item-rotation"
        label="Item Rotation"
        fullWidth
        value={selectedItemRotation || selectedItem.rotation?.toString() || ''}
        variant="standard"
        placeholder="0"
        onChange={(e) => onFieldChange('rotation', e.target.value)}
        sx={{ mr: 1 }}
      />
      <TextField
        name="item-pairing"
        label="Item Pairing"
        fullWidth
        value={selectedItemPairId || selectedItem.pairId || selectedItem.pairedBy?.id || ''}
        variant="standard"
        placeholder="Pair ID"
        onChange={(e) => onFieldChange('pairId', e.target.value)}
        sx={{ mr: 1 }}
      />
    </div>
    <div className="flex items-center gap-2">
      <Button variant="contained" onClick={onSave}>
        Save
      </Button>
      <Button variant="outlined" color="error" onClick={onDelete}>
        Delete
      </Button>
      <Button variant="outlined" onClick={onPrint}>
        QR Code
      </Button>
      <Button variant="outlined" onClick={onPair}>
        PAIR
      </Button>
    </div>
  </div>
)

export default function InventoryView() {

  const { site, apiKey } = useSite()
  const inventory = site.inventoryItems || []
  const siteId = site.id || ''
  let siteLat = site.locationLat
  let siteLng = site.locationLng

  // track existing selection
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = inventory.find((item) => item.id === selectedItemId)

  // new creation flow
  const [creating, setCreating] = useState<boolean>(false)

  // edited fields
  const [selectedItemNumber, setSelectedItemNumber] = useState<string>('')
  const [selectedItemGroup, setSelectedItemGroup] = useState<string>('')
  const [selectedItemLabel, setSelectedItemLabel] = useState<string>('')
  const [selectedItemCategory, setSelectedItemCategory] = useState<string>('')
  const [selectedItemPrice, setSelectedItemPrice] = useState<string>('')
  const [selectedItemRotation, setSelectedItemRotation] = useState<string>('')
  const [selectedItemPairId, setSelectedItemPairId] = useState<string>('')
  const [pairingMode, setPairingMode] = useState<boolean>(false)

  // map & zoom
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)
  const [zoom, setZoom] = useState<number>(20)
  const dynamicSize = getScaledSize(zoom)

  // When fields change for the form
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

  const handleSave = (): void => {
    if (!selectedItem) return
    const changedValues: {
      number?: number
      group?: number
      label?: string
      category?: string
      price?: number
      rotation?: number
      pairId?: string
    } = {}
    if (selectedItemNumber) changedValues.number = Number(selectedItemNumber)
    if (selectedItemGroup) changedValues.group = Number(selectedItemGroup)
    if (selectedItemLabel) changedValues.label = selectedItemLabel
    if (selectedItemCategory) changedValues.category = selectedItemCategory
    if (selectedItemPrice) changedValues.price = Number(selectedItemPrice)
    if (selectedItemRotation) changedValues.rotation = Number(selectedItemRotation)
    if (selectedItemPairId) changedValues.pairId = selectedItemPairId
    saveInventoryItemProperties(selectedItem.id, changedValues)
  }

  const handleDelete = (): void => {
    if (selectedItem) {
      deleteInventoryItem(selectedItem.id)
      setSelectedItemId(null)
    }
  }

  const handlePrint = (): void => {
    if (selectedItem) {
      const qrCodeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/sites/${siteId}/pos/${selectedItem.id}`
      // Print handled by QrPrintButton normally
    }
  }

  const handlePair = (): void => {
    setPairingMode(true)
  }

  // 1) User clicks “Add Item” → enter creation mode
  const handleStartCreate = (): void => {
    setCreating(true)
    setSelectedItemId(null)
  }

  // 2) Map click behavior: if creating, create then place; otherwise normal drag
  const handleMapClick = async (e: any) => {
    const lat = e.detail.latLng?.lat
    const lng = e.detail.latLng?.lng
    if (!lat || !lng) return

    if (creating) {
      // create the new item without a location
      const result = await createInventoryItem({ siteId })
      const newItem = result.item as InventoryItem

      // immediately set the selected id and location
      setSelectedItemId(newItem.id)
      await saveInventoryItemLocation(newItem.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
      setCreating(false)
    } else if (selectedItem && typeof lat === 'number' && typeof lng === 'number') {
      // normal drag end: update location
      saveInventoryItemLocation(selectedItem.id, {
        locationLat: lat.toString(),
        locationLng: lng.toString(),
      })
    }
  }

  const handleMarkerClick = (item: InventoryItem): void => {
    if (pairingMode && selectedItem && item.id !== selectedItem.id) {
      setSelectedItemPairId(item.id)
      setPairingMode(false)
    } else {
      setSelectedItemPairId('')
      setSelectedItemId(prev => (prev === item.id ? null : item.id))
      setCreating(false)
    }
  }

  const handleMarkerDragEnd = (item: InventoryItem, e: any): void => {
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
      <div className="flex justify-between mt-4 mb-6">
        {
          (!creating && !selectedItem) ?
            <Button variant="outlined" onClick={handleStartCreate}>
              + Add Item
            </Button> : 
            <div className='flex items-center'>
              <Button startIcon={<CloseIcon />} variant="text" onClick={() => {
                setSelectedItemId(null)
                setCreating(false)
              }}>
                Cancel
              </Button>
            </div>
        }
        
        <QrPrintButton siteId={siteId} label="Print all QR Codes" items={inventory} />
      </div>

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
        <div className="w-full h-[400px] border border-2 border-gray-400 mt-2">
          <APIProvider apiKey={apiKey}>
            <Map
              mapId="7a0196a7ba317ea5"
              defaultZoom={18}
              defaultCenter={
                siteLat && siteLng
                  ? { lat: Number(siteLat), lng: Number(siteLng) }
                  : { lat: 35.5138298, lng: Number(24.0180367) }
              }
              gestureHandling="greedy"
              disableDefaultUI
              onZoomChanged={(mapInstance) => {
                const newZoom = mapInstance.map.getZoom()
                setZoom(newZoom || 20)
              }}
              onClick={handleMapClick}
            >
              {inventory.map((item) => (
                <SunbedMarker
                  key={item.id}
                  item={item}
                  dynamicSize={dynamicSize}
                  zoom={zoom}
                  selected={selectedItem?.id === item.id}
                  pairedSelected={
                    selectedItem
                      ? item.id === selectedItem.pairId || item.id === selectedItem.pairedBy?.id
                      : false
                  }
                  onClick={() => handleMarkerClick(item)}
                  onDragEnd={(e) => handleMarkerDragEnd(item, e)}
                />
              ))}
            </Map>
            <CustomMapControl controlPosition={ControlPosition.TOP_LEFT} onPlaceSelect={setSelectedPlace} />
            <MapHandler place={selectedPlace} />
          </APIProvider>
        </div>
        <div className="w-full mt-4 text-sm md:text-base">
          {selectedItem && <Reservations reservations={selectedItem.reservations || []} />}
        </div>
      </div>
    </div>
  )
}
