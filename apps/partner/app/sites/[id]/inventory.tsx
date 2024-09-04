'use client'

import Link from 'next/link'
import Image from 'next/image'
import { createInventoryItem, deleteInventoryItem, saveInventoryItem } from './actions'
import { useState } from 'react'
import Chip from '@mui/material/Chip'
import { InventoryItem } from '../types'
import { APIProvider, AdvancedMarker, ControlPosition, Map } from '@vis.gl/react-google-maps'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import umbrellaImage from './umbrella-2.png'

export default function Inventory({ siteId, siteLat, siteLng, inventory, apiKey } : { siteId: string, siteLat: string, siteLng: string, inventory: InventoryItem[], apiKey: string }) {
  
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  const inventoryMap: { [key: string]: InventoryItem } = {
  }

  inventory.forEach(item => {
    inventoryMap[item.id] = item
  })

  const beachFlagImg: HTMLImageElement = document.createElement('img');
  beachFlagImg.src = 'https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png';

  console.log('Inventory', inventory)

  return (
    <div className="container mx-auto">
      <div className="mt-6 flex flex-wrap">
        {
          inventory.map(item => {
            
            const bgColor = (item.reservations?.length || 0) > 0 ? 'info' : 'success'

            const borderColor = (item.reservations?.length || 0) > 0 ? 'border-gray-600' : 'border-gray-400'
            const borderStyle = (selectedItem && selectedItem.id === item.id) ? 'filled' : 'outlined'

            return <Chip
              label={`Item ${String(item.number).padStart(4, '0')}`}
              variant={borderStyle}
              color={Number(item.locationLat) === 0 ? 'default' : bgColor}
              sx={{ margin: '4px' }}
              onClick={() => {
                if (selectedItem && selectedItem.id === item.id) {
                  setSelectedItem(null)
                } else {
                  setSelectedItem(inventoryMap[item.id] || null)
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
            setSelectedItem(result.item as unknown as InventoryItem)
          }}
        />
      </div>   
      <div className="mt-6 flex justify-between flex-col">
        {
          (selectedItem && Number(selectedItem.locationLat) === 0) &&
            <div className="w-full bg-yellow-400 p-2 text-gray-600 font-bold">
              Place item on the map:
            </div>
        }
        <div className="w-full h-[400px]">
          <APIProvider apiKey={apiKey}>
            <Map mapId={'7a0196a7ba317ea5'}
              defaultZoom={18}
              defaultCenter={(siteLat && siteLng) ? {
                lat: Number(siteLat),
                lng: Number(siteLng)
              } : { lat: 35.5138298, lng: 24.0180367 }}
              gestureHandling={'greedy'}
              disableDefaultUI={true}
              onClick={(e) => {
                console.log('Map click', e)
                const lat = e.detail.latLng?.lat
                const lng = e.detail.latLng?.lng
                if (selectedItem && lat && lng) {
                  selectedItem.locationLat = lat.toString()
                  selectedItem.locationLng = lng.toString()
                  saveInventoryItem(selectedItem.id, { locationLat: lat.toString(), locationLng: lng.toString() })
                }
              }}
            >
              {
                (inventory.map(item => (
                  (item.id !== selectedItem?.id) && <AdvancedMarker key={item.id}
                    position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }} >
                    <div className="rounded-full absolute -top-[40px] -left-[40px]">
                      <Image width={80} src={umbrellaImage} alt="Item" />
                    </div>
                  </AdvancedMarker>)))
              }
              {
                (selectedItem?.locationLat && selectedItem?.locationLng) &&
                  <AdvancedMarker position={{ lat: Number(selectedItem.locationLat), lng: Number(selectedItem.locationLng) }}>
                    <div className="bg-white border-2 border-red-600 rounded-full absolute -top-[40px] -left-[40px] scale-50 z-10">
                      <Image width={80} src={umbrellaImage} alt="Item" />
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
        <div className="w-full">
          {
            (selectedItem?.reservations || []).map((r, i) => (
              <div key={`r-${i}`} className="mb-4">
                {r.from.toISOString()} - {r.to.toISOString()}: {r.status}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )

}