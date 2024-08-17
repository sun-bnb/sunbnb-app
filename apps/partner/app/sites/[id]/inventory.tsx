'use client'

import Link from 'next/link'
import { createInventoryItem, deleteInventoryItem, saveInventoryItem } from './actions'
import { useState } from 'react'
import { InventoryItem } from '../types'
import { APIProvider, AdvancedMarker, ControlPosition, Map } from '@vis.gl/react-google-maps'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'

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

  
  return (
    <div className="container mx-auto">
      <div className="mt-6 flex flex-wrap">
        {
          inventory.map(item => (
            <div key={item.id} className={
              !selectedItem || selectedItem.id !== item.id ? 
                'h-[32px] relative mt-[2px] mr-2 border border-gray-400 rounded-lg  w-[111px] lg:w-[120px] flex justify-center align-middle' :
                'h-[32px] relative mt-[2px] mr-2 border border-gray-600 bg-gray-200 rounded-lg w-[111px] lg:w-[120px] flex justify-center align-middle'
            }
              onClick={() => {
                if (selectedItem && selectedItem.id === item.id) {
                  setSelectedItem(null)
                } else {
                  setSelectedItem(inventoryMap[item.id] || null)
                }
              }}>
              <label className="-ml-4 mt-[2px]">Item {item.number}</label>
              <label className="bg-white absolute w-4 h-4 right-[4px] top-[7px] cursor-pointer border border-gray-400 rounded-full" onClick={() => deleteInventoryItem(item.id)}>
                <div className="-mt-[7px] ml-[3px] text-gray-400">x</div>
              </label>
            </div>
          ))
        }
        <div className="h-[32px] mt-[2px] mr-2 border border-gray-300 border-dashed rounded-lg w-[111px] flex justify-center">
          <button onClick={() => createInventoryItem({ siteId })}>+ Add item</button>
        </div>
      </div>
      {
        selectedItem ? (    
          <div className="mt-6 flex justify-between flex-col lg:flex-row">
            <div className="w-full lg:w-1/2">
              <div className="mb-4">
                Item {selectedItem.number}: {selectedItem.status}
              </div>
            </div>
            <div className="w-full lg:w-1/2 h-[400px]">
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
                    if (lat && lng) {
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
                        <img src="https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png" />
                      </AdvancedMarker>)))
                  }
                  {
                    (selectedItem?.locationLat && selectedItem?.locationLng) &&
                      <AdvancedMarker position={{ lat: Number(selectedItem.locationLat), lng: Number(selectedItem.locationLng) }} />

                  }
                  
                </Map>
                <CustomMapControl
                  controlPosition={ControlPosition.TOP_LEFT}
                  onPlaceSelect={setSelectedPlace}
                />

                <MapHandler place={selectedPlace} />
              </APIProvider>
            </div>
          </div>
        ) : (    
          <div className="mt-6 flex justify-between">
            <div className="w-[100%] h-[400px]">
              <APIProvider apiKey={apiKey}>
                <Map mapId={'7a0196a7ba317ea5'}
                  defaultZoom={(inventory && inventory.length > 0) ? 18 : 9}
                  defaultCenter={(siteLat && siteLng) ? {
                    lat: Number(siteLat),
                    lng: Number(siteLng)
                  } : { lat: 35.5138298, lng: 24.0180367 }}
                  gestureHandling={'greedy'}
                  disableDefaultUI={true}
                >
                  {
                    (inventory.map(item => (
                      <AdvancedMarker key={item.id} position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}>
                        <img src="https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png" />
                      </AdvancedMarker>
                    )))
                  }
                  
                </Map>
                <CustomMapControl
                  controlPosition={ControlPosition.TOP_LEFT}
                  onPlaceSelect={setSelectedPlace}
                />

                <MapHandler place={selectedPlace} />
              </APIProvider>
            </div>
          </div>
        )
      }
    </div>
  )

}