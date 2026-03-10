'use client'

import logger from '@/utils/logger'

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
import { APIProvider, AdvancedMarker, Map, useMap } from '@vis.gl/react-google-maps'
import { MarkerClusterer, type Marker } from '@googlemaps/markerclusterer'
import CloseIcon from '@mui/icons-material/Close'
import { useState, useCallback, useEffect, useRef } from 'react'
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
    <div className="bg-white rounded-xl overflow-hidden shadow-soft md:hover:shadow-card md:transition-shadow" key={site.id}>
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
    <div className="mt-3 px-2 md:px-4 lg:px-6 space-y-4 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-5 lg:gap-6">
      {
        sites.map(site => (
          <Site key={site.id} site={site} />
        ))
      }
    </div>
  )

}

function ClusteredMarkers({ sites, selectedSite, onMarkerClick }: {
  sites: SiteProps[]
  selectedSite: SiteProps | null
  onMarkerClick: (site: SiteProps) => void
}) {
  const map = useMap()
  const clusterer = useRef<MarkerClusterer | null>(null)
  const markersRef = useRef<{ [key: string]: Marker }>({})
  const syncTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  console.log('[Cluster] ClusteredMarkers render — map:', !!map, 'sites:', sites.length)

  useEffect(() => {
    if (!map) {
      console.log('[Cluster] No map instance yet')
      return
    }
    if (!clusterer.current) {
      console.log('[Cluster] Creating MarkerClusterer')
      clusterer.current = new MarkerClusterer({
        map,
        renderer: {
          render: ({ count, position }) => {
            console.log('[Cluster] Rendering cluster with count:', count, 'at:', position)
            const el = document.createElement('div')
            el.className = 'cluster-marker'
            el.style.cssText = `
              width: ${Math.min(28 + count * 2, 56)}px;
              height: ${Math.min(28 + count * 2, 56)}px;
              background: #1f2937;
              color: white;
              border-radius: 9999px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 13px;
              font-weight: 600;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              border: 2px solid white;
              cursor: pointer;
              transition: transform 0.15s;
            `
            el.textContent = String(count)
            el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.1)' })
            el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })

            const markerEl = new (window as any).google.maps.marker.AdvancedMarkerElement({
              position,
              content: el,
              zIndex: 1000 + count,
            })
            return markerEl
          }
        }
      })
    }
  }, [map])

  const syncMarkers = useCallback(() => {
    if (!clusterer.current) {
      console.log('[Cluster] Sync skipped — no clusterer')
      return
    }
    const currentMarkers = Object.values(markersRef.current)
    console.log('[Cluster] Syncing markers to clusterer — count:', currentMarkers.length)
    clusterer.current.clearMarkers()
    if (currentMarkers.length > 0) {
      clusterer.current.addMarkers(currentMarkers)
    }
  }, [])

  // Schedule a debounced sync whenever a marker ref is set
  const scheduleSyncRef = useCallback(() => {
    if (syncTimeout.current) clearTimeout(syncTimeout.current)
    syncTimeout.current = setTimeout(() => {
      syncMarkers()
    }, 100)
  }, [syncMarkers])

  // Also sync when sites array changes
  useEffect(() => {
    scheduleSyncRef()
  }, [sites, scheduleSyncRef])

  const setMarkerRef = useCallback((marker: Marker | null, siteId: string) => {
    if (marker) {
      markersRef.current[siteId] = marker
      console.log('[Cluster] Marker ref set for:', siteId, 'total:', Object.keys(markersRef.current).length)
      scheduleSyncRef()
    } else {
      delete markersRef.current[siteId]
    }
  }, [scheduleSyncRef])

  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  return (
    <>
      {sites.map(site => (
        <SafeAdvancedMarker
          key={site.id}
          position={{ lat: Number(site.locationLat), lng: Number(site.locationLng) }}
          ref={(marker: Marker | null) => setMarkerRef(marker, site.id!)}
          onClick={() => onMarkerClick(site)}
        >
          {
            site.id === selectedSite?.id ? (
              <div className="animate-bounce">
                <div className="w-[44px] h-[44px] bg-white rounded-full flex justify-center items-center shadow-card border-2 border-brand-cyan ring-2 ring-brand-cyan/30">
                  <span className="text-3xl leading-none">&#x26F1;</span>
                </div>
              </div>
            ) : (
              <div className="w-[36px] h-[36px] bg-white/90 rounded-full flex justify-center items-center shadow-sm border border-gray-200 hover:shadow-card hover:scale-110 transition-all duration-150 cursor-pointer">
                <span className="text-2xl leading-none">&#x26F1;</span>
              </div>
            )
          }
        </SafeAdvancedMarker>
      ))}
    </>
  )
}

function SiteMap({ sites, geography, apiKey }: { sites: SiteProps[], geography?: SiteGeography, apiKey: string }) {

  const [selectedSite, setSelectedSite] = useState<SiteProps | null>(null)

  const defaultBounds = geography?.bounds
  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>

  const handleMarkerClick = useCallback((site: SiteProps) => {
    setSelectedSite(site)
  }, [])

  return (
    <div className="px-2 md:px-4 lg:px-6 lg:flex lg:gap-5" key={`${geography?.center.lat}-${geography?.center.lng}-${geography?.bounds?.north}-${geography?.bounds?.south}-${geography?.bounds?.east}-${geography?.bounds?.west}`}>
      <div className={`w-full mt-3 rounded-xl overflow-hidden shadow-soft transition-all duration-300 ${selectedSite ? 'h-[250px] md:h-[400px] lg:h-[550px]' : 'h-[300px] md:h-[450px] lg:h-[550px]'} ${selectedSite ? 'lg:flex-[3]' : ''}`}>
        <SafeAPIProvider apiKey={apiKey}>
          <SafeMap mapId={'7a0196a7ba317ea5'}
            defaultZoom={defaultBounds ? undefined : 8}
            defaultCenter={geography ? geography.center : { lat: 35.5138298, lng: 24.0180367 }}
            defaultBounds={defaultBounds}
            gestureHandling={'greedy'}
            disableDefaultUI={true}
            onClick={() => {
              setSelectedSite(null)
            }}
          >
            <ClusteredMarkers
              sites={sites}
              selectedSite={selectedSite}
              onMarkerClick={handleMarkerClick}
            />
          </SafeMap>
        </SafeAPIProvider>
      </div>
      {
        selectedSite && (
          <div className="mt-3 lg:mt-3 lg:flex-[2] lg:max-w-sm animate-in fade-in">
            <div className="relative">
              <button 
                onClick={() => setSelectedSite(null)}
                className="absolute -top-2 -right-2 z-10 w-7 h-7 bg-white rounded-full shadow-card flex items-center justify-center hover:bg-gray-50 transition-colors"
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </button>
              <Site site={selectedSite} />
            </div>
          </div>
        )
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
    <div className="mx-auto pt-[80px] bg-cream max-w-5xl">
      <div>
        <div className="flex justify-between items-center py-3 px-3 md:px-4 lg:px-6">
          <div>
            <div className="text-xs font-medium tracking-wide uppercase text-gray-400">
              <span className="font-bold text-gray-700 mr-1">{ searchResponse?.sites?.length || sites.length }</span>
              <span>{t('BEACHES')}</span>
            </div>
            {
              !selectedPlace ? (
                <div className="text-sm text-gray-500 mt-0.5">
                  <span>{t('Showing all beaches')}</span>
                </div>
              ) : (
                <div className="text-sm text-gray-500 mt-0.5">
                  <span className="mr-1">near</span>
                  <span className="font-semibold text-gray-700">{selectedPlace.mainText}</span>
                </div>
              )
            }
          </div>
          <div className="flex bg-white/60 border border-gray-200 rounded-full p-0.5 shadow-sm">
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                viewMode === 'map'
                  ? 'bg-gray-800 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <MapIcon sx={{ fontSize: 16 }} />
              {t('MAP')}
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-gray-800 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ListAltIcon sx={{ fontSize: 16 }} />
              {t('LIST')}
            </button>
          </div>
        </div>
      </div>
      {
        viewMode === 'list' ? (
          <SiteList sites={searchResponse?.sites ?? sites} />
        ) : (
          <SiteMap sites={searchResponse?.sites ?? sites} 
            geography={searchResponse?.geography ?? geography}
            apiKey={apiKey} />
        )
      }
      <footer className="py-6 md:py-8 mt-6 md:mt-8 text-center border-t border-gray-200/60">
        <p className="text-[11px] text-gray-400">
          © {new Date().getFullYear()} Sunbnb · <a href="/tos" className="underline hover:text-gray-600">Terms</a> · <a href="/privacy" className="underline hover:text-gray-600">Privacy</a>
        </p>
      </footer>
    </div>
  )

}
