'use client'

import { SiteProps } from '@/app/sites/types'
import SiteEdit from './edit'
import { useState } from 'react'

export default function SiteView({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const [ mode, setMode ] = useState('view')

  return (
    <div className="container mx-auto px-4">
      { 
        mode === 'view' ? (
          <div>
            <div>
              { site.name }
            </div>
            <button onClick={() => setMode('edit')}>Edit</button>
          </div>
        ) : (
          <SiteEdit site={site} apiKey={apiKey} />
        )
      
      }
    </div>
  )

}