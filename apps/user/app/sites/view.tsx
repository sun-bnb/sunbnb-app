'use client'

import logger from '@/utils/logger'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Link from 'next/link'
import Image from 'next/image'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import MapIcon from '@mui/icons-material/Map'
import SurfingIcon from '@mui/icons-material/Surfing'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import ListAltIcon from '@mui/icons-material/ListAlt'
import { useTranslations } from 'next-intl'
import { SiteGeography, SiteProps } from './types'
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

const serviceIcons: {
  [key: string]: React.ReactElement
} = {
  'wc': <WcIcon />,
  'food': <RestaurantIcon />,
  'drinks': <LocalBarIcon />,
  'rental': <SurfingIcon />
}

function Site({ site }: { site: SiteProps }) {
  return (
    <div className="mb-4 bg-white rounded-xl overflow-hidden shadow-soft" key={site.id}>
      <div className="w-full max-h-[260px] mr-2 overflow-hidden bg-gray-50 flex items-center relative">
        { 
          site.image && 
          <Link className="w-full" href={`/sites/${site.id}`} prefetch={true}>
            {
              (site.imageWidth && site.imageHeight) &&
                <Image width={site.imageWidth} height={site.imageHeight} alt={site.description || ''} src={site.image} />
    }
          </Link>
        }
        <div className="font-semibold text-white px-3 py-1 absolute top-2 left-2 bg-black/30 rounded-lg text-sm backdrop-blur-sm">
          <Link href={`/sites/${site.id}`} prefetch={true}>{site.name}</Link>
        </div>
      </div>
      <div className="py-3 px-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3 text-sm">
            <div>
              <span className="mr-1">&#x26F1;</span>
              <span className={(site.availableCount || 0) > 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>{site.availableCount}</span>
              <span className="text-gray-300 mx-px">/</span>
              <span className="text-gray-400">{site.itemCount}</span>
            </div>
            {
              site.distance &&
                <div className="text-gray-600">
                  <span className="mr-px">{Math.round(site.distance)}</span>
                  <span className="text-xs text-gray-400">KM</span>
                </div>
            }
            {
              site.price &&
                <div className="text-gray-700 font-medium">
                  <span>&#8364;</span>
                  <span>{site.price}</span>
                </div>
            }
            
          </div>
          <div className="flex gap-1">
            {
              (site.services || []).map(service => {
                return (
                  <div key={`service-${service}`} className="border border-gray-200 rounded-md px-1 py-px text-gray-500">
                    <div className="-mt-px">
                      { serviceIcons[service] }
                    </div>
                  </div>
                )
              })
            }
          </div>
        </div>
        {
          site.description && (
            <div className="pt-2 text-sm text-gray-600 leading-relaxed">
              { site.description }
            </div>
          )
        }
      </div>
    </div>
  )
}

function SiteList({ sites }: { sites: SiteProps[] }) {

  return (
    <div className="mt-3 px-2">
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
  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  return (
    <div key={`${geography?.center.lat}-${geography?.center.lng}-${geography?.bounds?.north}-${geography?.bounds?.south}-${geography?.bounds?.east}-${geography?.bounds?.west}`}>
      <div className="w-full h-[300px] mt-[12px]">
        <SafeAPIProvider apiKey={apiKey}>
          <SafeMap mapId={'7a0196a7ba317ea5'}
            defaultZoom={defaultBounds ? undefined : 8}
            defaultCenter={geography ? geography.center : { lat: 35.5138298, lng: 24.0180367 }}
            defaultBounds={defaultBounds}
            gestureHandling={'greedy'}
            disableDefaultUI={true}
            onClick={(_e: unknown) => {
              setSelectedSite(null)
            }}
          >
            {
              (sites.map(site => (
                (site.id !== selectedSite?.id) && <SafeAdvancedMarker key={site.id}
                  position={{ lat: Number(site.locationLat), lng: Number(site.locationLng) }}
                  onClick={() => {
                    setSelectedSite(site)
                  }}>
                  <div className="w-[40px] h-[40px] bg-yellow-100 rounded-full flex justify-center shadow-soft border border-yellow-200">
                    <span className="text-4xl">&#x26F1;</span>
                  </div>
                </SafeAdvancedMarker>)))
            }
            {
              (selectedSite?.locationLat && selectedSite?.locationLng) &&
                <SafeAdvancedMarker position={{ lat: Number(selectedSite.locationLat), lng: Number(selectedSite.locationLng) }}>
                  <div className="border border-[4px] border-red-800 w-[46px] h-[46px] bg-yellow-400 rounded-full flex justify-center">
                    <span className="text-4xl">&#x26F1;</span>
                  </div>
                </SafeAdvancedMarker>

            }
          </SafeMap>
        </SafeAPIProvider>
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
  geography?: SiteGeography,
  apiKey: string 
} ) {

  const [ viewMode, setViewMode ] = useState<string>('list')

  const searchState = useSelector((state: RootState) => state.search)
  const { selectedPlace } = searchState

  const t = useTranslations('SitesView')

  logger.debug('Selected place', selectedPlace)

  const { data: placeDetails } = useGetPlaceDetailsQuery(selectedPlace?.placeId, {
    skip: !selectedPlace
  })

  const { data: searchResponse } = useGetSitesByCoordsQuery({ lat: placeDetails?.lat, lng: placeDetails?.lng }, {
    skip: !placeDetails
  })

  logger.debug('Search response', searchResponse)

  return (
    <div className="container mx-auto pt-[80px] bg-cream">
      <div className="flex justify-between items-center py-2 px-3">
        <div>
          <div className="text-sm text-gray-600">
            <span className="mr-1 font-bold">{ searchResponse?.sites.length || sites.length }</span>
            <span>{t('BEACHES')}</span>
          </div>
          {
            !selectedPlace ? (
              <div className="text-gray-600">
                <span>{t('Showing all beaches')}</span>
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
                  {t('MAP')}
                </div>
                <MapIcon sx={{ fontSize: '24px', marginTop: '-12px' }}/>
              </div>
            </ToggleButton>
            <ToggleButton value="list" style={{ width: '42px', height: '42px' }}>
              <div className="mt-[3px]">
                <div style={{ fontSize: '10px' }}>
                  {t('LIST')}
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
