'use client'

import Link from 'next/link'
import Image from 'next/image'
import { createInventoryItem, deleteInventoryItem, saveInventoryItem, cancelReservation } from './actions'
import { useState } from 'react'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import { InventoryItem } from '../types'
import { APIProvider, AdvancedMarker, ControlPosition, Map } from '@vis.gl/react-google-maps'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import umbrellaImage from './umbrella-2.png'
import dayjs, { Dayjs } from 'dayjs'

const statusToChipColor: {
  [key: string]: 'default' | 'success' | 'error'
} = {
  'pending': 'default',
  'confirmed': 'success',
  'canceled': 'error'
}

const statusToChipLabel: {
  [key: string]: 'Pending' | 'Confirmed' | 'Canceled'
} = {
  'pending': 'Pending',
  'confirmed': 'Confirmed',
  'canceled': 'Canceled'
}

export default function Inventory({ siteId, siteLat, siteLng, inventory, apiKey } : { siteId: string, siteLat: string, siteLng: string, inventory: InventoryItem[], apiKey: string }) {
  
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  const inventoryMap: { [key: string]: InventoryItem } = {
  }

  const selectedItem = inventory.find(item => item.id === selectedItemId)

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
            
            const activeReservations = (item.reservations || [])
              .filter(reservation => reservation.status !== 'canceled')

            const bgColor = activeReservations.length > 0 ? 'info' : 'success'

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
        <div className="w-full mt-4 text-sm md:text-base">
          {
            (selectedItem?.reservations || []).map((reservation, i) => {
              let reservationElem = null

              const reservationControls = (
                <div className="flex justify-between">
                  <div className="">
                    {
                      reservation.status !== 'canceled' &&
                        <Button size="small" variant="outlined" color="error" onClick={() => {
                          cancelReservation(reservation.id)
                        }}>Cancel</Button>
                    }
                  </div>
                  <div className="flex mt-[6px]">
                    <div className="text-gray-400 mr-1 -mt-[1px]">
                      <MailOutlineIcon />
                    </div>
                    <div>{ reservation.user.email }</div>
                  </div>
                </div>
              )

              if (reservation.type === 'hours') {
                const formattedDate = dayjs(reservation.from).format('ddd, D MMM YYYY')
                const timeRangeFrom = `${dayjs(reservation.from).format('HH:mm')}`
                const timeRangeTo = `${dayjs(reservation.to).format('HH:mm')}`
                reservationElem = (
                  <div className="pt-1 mb-2 pb-2 border-b-[1px] border-gray-200">
                    <div className="flex justify-between align-center pb-1">
                      <div className="flex -mt-[7px]">
                        <div className="mr-4">{formattedDate}</div>
                        <div className="flex text-gray-600">
                          <div className="mr-1">{timeRangeFrom}</div>
                          <div>-</div>
                          <div className="ml-1">{timeRangeTo}</div>
                        </div>
                      </div>
                      <div className="-mt-1">
                        <Chip color={statusToChipColor[reservation.status]} 
                          label={statusToChipLabel[reservation.status]} 
                          sx={{ height: '26px' }} />
                      </div>
                    </div>
                    { reservationControls }
                  </div>
                )
              } else {
                const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
                const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')
                reservationElem = (
                  <div className="mb-2 pb-2 pt-1 border-b-[1px] border-gray-200">
                    <div className="flex justify-between align-center pb-1">
                      <div className="-mt-[7px]">
                        <div className="flex">
                          <div className="mr-1">{dateRangeFrom}</div>
                          <div>-</div>
                          <div className="ml-1">{dateRangeTo}</div>
                        </div>
                      </div>
                      <div className="-mt-1">
                        <Chip color={statusToChipColor[reservation.status]} 
                          label={statusToChipLabel[reservation.status]}
                          sx={{ height: '26px' }} />
                      </div>
                    </div>
                    { reservationControls }
                  </div>
                )
              }
              return (
                <div key={reservation.id}>{reservationElem}</div>
              )
            })
          }
        </div>
      </div>
    </div>
  )

}