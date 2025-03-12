'use client'

import Image from 'next/image'
import { 
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties
} from '../actions'
import { useState } from 'react'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import { InventoryItem } from '../../../../types/shared'
import { APIProvider, AdvancedMarker, ControlPosition, Map } from '@vis.gl/react-google-maps'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import sunbedIcon from './sunbed-icon-transparent.png'
import Reservations from './reservations'
import Button from '@mui/material/Button'

export default function Inventory(
  { siteId, siteLat, siteLng, inventory, apiKey } : 
  { siteId: string, siteLat: string, siteLng: string, inventory: InventoryItem[], apiKey: string }
) {
  
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)
  const [selectedItemCategory, setSelectedItemCategory] = useState<string | undefined>(undefined)
  const [selectedItemPrice, setSelectedItemPrice] = useState<string | undefined>(undefined)
  const [selectedItemRotation, setSelectedItemRotation] = useState<string | undefined>(undefined)

  const [zoom, setZoom] = useState<number>(20)

  function getScaledSize(zoom: number): number {
    const baseZoom = 20
    const baseSize = 45
    // Adjust scale factor as you like (linear or exponential)
    return baseSize * Math.pow(2, (zoom - baseZoom) / 2)
  }
  
  const dynamicSize = getScaledSize(zoom)

  const inventoryMap: { [key: string]: InventoryItem } = {
  }

  const selectedItem = inventory.find(item => item.id === selectedItemId)

  inventory.forEach(item => {
    inventoryMap[item.id] = item
  })

  const beachFlagImg: HTMLImageElement = document.createElement('img')
  beachFlagImg.src = 'https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png'

  console.log('Inventory', inventory)

  const now = new Date()

  return (
    <div className="container mx-auto">
      <div className="mt-6 flex flex-wrap">
        {
          inventory.map((item: InventoryItem) => {
            
            const activeReservations = (item.reservations || [])
              .filter(reservation => reservation.status !== 'canceled')
              .filter(reservation => reservation.to >= now)

            let bgColor: 'success' | 'info' | 'error' = 'success'

            if (activeReservations.length > 0) {
              
              bgColor = 'info'

              const now = new Date()

              const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
              const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

              const reservationActiveToday = activeReservations.find((reservation) => {
                const from = new Date(reservation.from)
                const to = new Date(reservation.to)
                console.log('Reservation', now, startOfToday, endOfToday, from, to)
                console.log('TODAY', now <= endOfToday)
                return from <= endOfToday && to >= startOfToday
              })

              if (reservationActiveToday) {
                bgColor = 'error'
              }

            }

            const borderColor = (item.reservations?.length || 0) > 0 ? 'border-gray-600' : 'border-gray-400'
            const borderStyle = (selectedItem && selectedItem.id === item.id) ? 'filled' : 'outlined'

            return <Chip
              label={`Item ${String(item.number).padStart(4, '0')}`}
              variant={borderStyle}
              color={Number(item.locationLat) === 0 ? 'default' : bgColor}
              sx={{ margin: '4px' }}
              onClick={() => {
                if (selectedItem && selectedItem.id === item.id) {
                  setSelectedItemId(null)
                } else {
                  setSelectedItemId(item.id)
                }
              }}
              onDelete={(e) => {
                deleteInventoryItem(item.id)
              }}
            />
          })
        }
        <Chip
          label="+ Add Item"
          variant="outlined"
          sx={{ margin: '4px' }}
          onClick={async (e) => {
            const result = await createInventoryItem({ siteId })
            setSelectedItemId((result.item as unknown as InventoryItem).id)
          }}
        />
      </div>
      {
        selectedItem && (
          <div className="flex justify-between mt-[6px] ml-[4px]">
            <div className="flex">
              <div className="mr-[6px]">
                <TextField
                  name="item-category"
                  label="Item category"
                  fullWidth={true}
                  value={selectedItemCategory || selectedItem.category || ''} 
                  variant="standard"
                  placeholder="PRICE1"
                  onChange={(e) => setSelectedItemCategory(e.target.value)}
                />
              </div>
              <div className="mr-[6px]">
                <TextField
                  name="item-price"
                  label="Item price"
                  fullWidth={true}
                  value={selectedItemPrice || selectedItem.price || ''} 
                  variant="standard"
                  placeholder="8.5"
                  onChange={(e) => setSelectedItemPrice(e.target.value)}
                />
              </div>
              <div className="mr-[6px]">
                <TextField
                  name="item-rotation"
                  label="Item rotation"
                  fullWidth={true}
                  value={selectedItemRotation || selectedItem.rotation || ''} 
                  variant="standard"
                  placeholder="0"
                  onChange={(e) => setSelectedItemRotation(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-[8px]">
              <Button variant="contained"
                onClick={() => {
                  
                  const changedValues: {
                    category?: string,
                    price?: number,
                    rotation?: number
                  } = {}

                  if (selectedItemCategory) changedValues.category = selectedItemCategory
                  if (selectedItemPrice) changedValues.price = Number(selectedItemPrice)
                  if (selectedItemRotation) changedValues.rotation = Number(selectedItemRotation)

                  saveInventoryItemProperties(selectedItem.id, changedValues)
                
                }}>
                  Save
              </Button>
            </div>
          </div>
        )
      }
      <div className="mt-6 flex justify-between flex-col">
        {
          (selectedItem && Number(selectedItem.locationLat) === 0) &&
            <div className="w-full bg-yellow-400 p-2 text-gray-600 font-bold">
              Place item on the map:
            </div>
        }
        <div className="w-full h-[400px] border border-2 border-gray-400">
          <APIProvider apiKey={apiKey}>
            <Map mapId={'7a0196a7ba317ea5'}
              defaultZoom={18}
              defaultCenter={(siteLat && siteLng) ? {
                lat: Number(siteLat),
                lng: Number(siteLng)
              } : { lat: 35.5138298, lng: 24.0180367 }}
              gestureHandling={'greedy'}
              disableDefaultUI={true}
              onZoomChanged={(mapInstance) => {
                const newZoom = mapInstance.map.getZoom()
                console.log('Zoom changed', newZoom)
                setZoom(newZoom || 20)
              }}
              onClick={(e) => {
                console.log('Map click', e)
                const lat = e.detail.latLng?.lat
                const lng = e.detail.latLng?.lng
                if (selectedItem && lat && lng) {
                  selectedItem.locationLat = lat.toString()
                  selectedItem.locationLng = lng.toString()
                  saveInventoryItemLocation(selectedItem.id, { locationLat: lat.toString(), locationLng: lng.toString() })
                }
              }}
            >
              {
                (inventory.map(item => (
                  (item.id !== selectedItem?.id) && <AdvancedMarker key={item.id}
                    position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }} >
                    <div className="rounded-full absolute -top-[40px] -left-[40px]">
                      <Image style={ item.rotation ? {
                        transform: `rotate(${item.rotation}deg)`,
                        transformOrigin: 'center',
                        display: 'block',
                        maxWidth: 'none',
                        height: 'auto',
                        width: `${dynamicSize}px`,
                        marginTop: `-${(dynamicSize - 40) / 2}px`
                      } : {}} width={80} src={sunbedIcon} alt="Item" />
                    </div>
                  </AdvancedMarker>)))
              }
              {
                (selectedItem?.locationLat && selectedItem?.locationLng) &&
                  <AdvancedMarker position={{ lat: Number(selectedItem.locationLat), lng: Number(selectedItem.locationLng) }}>
                    <div className="bg-white border-2 border-red-600 rounded-full absolute -top-[40px] -left-[40px] z-10">
                      <Image style={ selectedItem.rotation ? {
                        transform: `rotate(${selectedItem.rotation}deg)`,
                        transformOrigin: 'center',
                        display: 'block',
                        maxWidth: 'none',
                        height: 'auto',
                        width: `${dynamicSize}px`,
                        marginTop: `-${(dynamicSize - 40) / 2}px`
                      } : {}} src={sunbedIcon} alt="Item" />
                    </div>
                  </AdvancedMarker>

              }
              
            </Map>
            <CustomMapControl
              controlPosition={ControlPosition.TOP_LEFT}
              onPlaceSelect={setSelectedPlace}
            />

            <MapHandler place={selectedPlace} />
          </APIProvider>
        </div>
        <div className="w-full mt-4 text-sm md:text-base">
          {
            selectedItem ?
              (
                <Reservations reservations={selectedItem.reservations || []} />
              ) : (
                <></>
              )
          }
        </div>
      </div>
    </div>
  )

}