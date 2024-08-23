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
import styles from './page.module.css'
import Glow from './Glow'
import { SiteProps } from './sites/types'
import { useState } from 'react'

export default function Sites({ sites }: { sites: SiteProps[]} ) {

  const [ viewMode, setViewMode ] = useState<string>('list')
  
  return (
    <div className="container mx-auto -mt-2">
      <div className="flex justify-between py-1 px-2">
        <div>
          <div className="text-sm text-gray-600">
            <span className="mr-1 font-bold">{ sites.length }</span>
            <span>BEACHES</span>
          </div>
          <div className="text-gray-600">
            <span className="mr-1">near</span>
            <span className="font-bold">Kissamos</span>
          </div>
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
      <div>
        {
          sites.map(site => (
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
                      <span className="text-green-600">6</span>
                      <span className="text-gray-400 mx-[1px]">/</span>
                      <span className="text-gray-400">14</span>
                    </div>
                    <div className="mr-3">
                      <span className="mr-[2px]">1.8</span>
                      <span className="text-xs">KM</span>
                    </div>
                    <div className="mr-3">
                      <span>&#8364;</span>
                      <span>8</span>
                    </div>
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
          ))
        }
      </div>
    </div>
  )

}