'use client'

import Button from '@mui/material/Button'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Link from 'next/link'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import MapIcon from '@mui/icons-material/Map'
import ListAltIcon from '@mui/icons-material/ListAlt'
import { SiteGeography, SiteProps } from './sites/types'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { useState } from 'react'
import { useSelector } from 'react-redux'
import { RootState } from '@/store/store'
import { useGetPlaceDetailsQuery } from '@/store/features/autocomplete/autocompleteSlice'
import { useGetSitesByCoordsQuery } from '@/store/features/api/apiSlice'

interface MapCenter {
  lat: number;
  lng: number;
}

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}


function Site({ site }: { site: SiteProps }) {
  return (
    <div className="mb-6" key={site.id}>
      <div className="w-full h-[160px] mr-2 mt-1 overflow-hidden bg-gray-100 flex items-center relative">
        { 
          site.image && 
          <Link href={`/sites/${site.id}`}>
            <img width="100%" src={site.image} />
          </Link>
        }
        <div className="font-bold text-white px-2 py-1 absolute top-[6px] left-[6px] bg-black bg-opacity-30 rounded-xl">
          <Link href={`/sites/${site.id}`}>{site.name}</Link>
        </div>
      </div>
      <div className="py-3">
        <div className="px-1 flex justify-between">
          <div className="flex">
            <div className="mr-3 pl-1">
              <span className="mr-1">&#x26F1;</span>
              <span className={(site.availableCount || 0) > 0 ? 'text-green-600' : 'text-red-600'}>{site.availableCount}</span>
              <span className="text-gray-400 mx-[1px]">/</span>
              <span className="text-gray-400">{site.itemCount}</span>
            </div>
            {
              site.distance &&
                <div className="mr-3">
                  <span className="mr-[2px]">{Math.round(site.distance)}</span>
                  <span className="text-xs">KM</span>
                </div>
            }
            {
              site.price &&
                <div className="mr-3">
                  <span>&#8364;</span>
                  <span>{site.price}</span>
                </div>
            }
            
          </div>
          <div className="flex">
            <div className="mr-3 border border-gray-600 rounded-md pr-[5px] pl-[4px]">
              <RestaurantIcon sx={{ fontSize: '16px', marginTop: '-4px' }}/>
            </div>
            <div className="mr-3 border border-gray-600 rounded-md pr-[4px] pl-[4px]">
              <WcIcon sx={{ fontSize: '19px', marginTop: '-4px' }}/>
            </div>
          </div>
        </div>
        <div className="px-1 py-2">
          { site.description }
        </div>
      </div>
    </div>
  )
}

function SiteList({ sites }: { sites: SiteProps[] }) {

  return (
    <div>
        {
          sites.map(site => (
            <Site key={site.id} site={site} />
          ))
        }
      </div>
  )

}

function SiteMap({ sites, geography, apiKey }: { sites: SiteProps[], geography?: SiteGeography, apiKey: string }) {

  const [selectedSite, setSelectedSite] = useState<SiteProps | null>(null)

  const defaultBounds = geography?.bounds
  console.log('Default bounds', defaultBounds)

  return (
    <div>
      <div className="w-full lg:w-1/2 h-[300px]">
        <APIProvider apiKey={apiKey}>
          <Map mapId={'7a0196a7ba317ea5'}
            defaultZoom={defaultBounds ? undefined : 8}
            defaultCenter={geography ? geography.center : { lat: 35.5138298, lng: 24.0180367 }}
            defaultBounds={defaultBounds}
            gestureHandling={'greedy'}
            disableDefaultUI={true}
            onClick={(e) => {
              console.log('Map click', e)
              setSelectedSite(null)
            }}
          >
            {
              (sites.map(site => (
                (site.id !== selectedSite?.id) && <AdvancedMarker key={site.id}
                  position={{ lat: Number(site.locationLat), lng: Number(site.locationLng) }}
                  onClick={() => {
                    setSelectedSite(site)
                  }}>
                  <div className="w-[40px] h-[40px] bg-yellow-200 rounded-full flex justify-center">
                    <span className="text-4xl">&#x26F1;</span>
                  </div>
                </AdvancedMarker>)))
            }
            {
              (selectedSite?.locationLat && selectedSite?.locationLng) &&
                <AdvancedMarker position={{ lat: Number(selectedSite.locationLat), lng: Number(selectedSite.locationLng) }}>
                  <div className="border border-[4px] border-red-800 w-[46px] h-[46px] bg-yellow-400 rounded-full flex justify-center">
                    <span className="text-4xl">&#x26F1;</span>
                  </div>
                </AdvancedMarker>

            }
          </Map>
        </APIProvider>
      </div>
      {
        selectedSite &&
          <div className="mt-2">
            <Site site={selectedSite} />
          </div>
      }
    </div>
  )

}

export default function Sites({ sites, geography, apiKey }: { 
  sites: SiteProps[],
  geography: SiteGeography,
  apiKey: string 
} ) {

  const [ viewMode, setViewMode ] = useState<string>('list')

  const searchState = useSelector((state: RootState) => state.search)
  const { selectedPlace } = searchState

  console.log('Selected place', selectedPlace)

  const { data: placeDetails } = useGetPlaceDetailsQuery(selectedPlace?.placeId, {
    skip: !selectedPlace
  })


  console.log('Place details', placeDetails)

  const { data: searchResponse } = useGetSitesByCoordsQuery({ lat: placeDetails?.lat, lng: placeDetails?.lng }, {
    skip: !placeDetails
  })

  console.log('Search response', searchResponse)

  return (
    <div className="container mx-auto -mt-2">
      <div className="flex justify-between py-1 px-2">
        <div>
          <div className="text-sm text-gray-600">
            <span className="mr-1 font-bold">{ sites.length }</span>
            <span>BEACHES</span>
          </div>
          {
            !selectedPlace ? (
              <div className="text-gray-600">
                <span>Showing all beaches</span>
              </div>
            ) : (
              <div className="text-gray-600">
                <span className="mr-1">near</span>
                <span className="font-bold">{selectedPlace.mainText}</span>
              </div>
            )
          }
        </div>
        <div>
          <ToggleButtonGroup
            color="primary"
            value={viewMode}
            exclusive
            onChange={(e, value) => {
              setViewMode(value)
            }}
            aria-label="View selection"
          >
            <ToggleButton value="map" style={{ width: '42px', height: '42px' }}>
              <div className="mt-[3px]">
                <div style={{ fontSize: '10px' }}>
                  MAP
                </div>
                <MapIcon sx={{ fontSize: '24px', marginTop: '-12px' }}/>
              </div>
            </ToggleButton>
            <ToggleButton value="list" style={{ width: '42px', height: '42px' }}>
              <div className="mt-[3px]">
                <div style={{ fontSize: '10px' }}>
                  LIST
                </div>
                <ListAltIcon sx={{ fontSize: '24px', marginTop: '-12px' }}/>
              </div>
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
      </div>
      {
        viewMode === 'list' ? (
          <SiteList sites={(searchResponse?.sites || sites)} />
        ) : (
          <SiteMap sites={(searchResponse?.sites || sites)} 
            geography={searchResponse?.geography || geography}
            apiKey={apiKey} />
        )
      }
    </div>
  )

}