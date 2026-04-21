'use client'

import { useTranslations } from 'next-intl'
import { SCHEMATIC_DRAG_MIME } from '@repo/schematic/renderer'
import { SURFACE_TYPES, OBJECT_TYPES, beachPalette } from './palette'

const LABEL_KEY: Record<string, string> = {
  water: 'areaWater',
  sand: 'areaSand',
  grass: 'areaGrass',
  deck: 'areaDeck',
  pool: 'areaPool',
  bar: 'poiBar',
  reception: 'poiReception',
  shower: 'poiShower',
  restroom: 'poiRestroom',
}

export default function ElementPalette() {
  const t = useTranslations('SiteSchematic')

  function tile(type: string) {
    const visual = beachPalette[type]
    const labelKey = LABEL_KEY[type] ?? type
    return (
      <div
        key={type}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SCHEMATIC_DRAG_MIME, type)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        className="flex items-center gap-2 px-3 py-2 rounded text-xs border border-gray-200 hover:bg-gray-50 cursor-grab active:cursor-grabbing select-none"
      >
        <span
          className="inline-block w-4 h-4 rounded"
          style={{ background: visual?.fill, border: `1px solid ${visual?.stroke ?? '#1f2937'}` }}
        />
        <span>{t(labelKey)}</span>
      </div>
    )
  }

  return (
    <div className="w-56 border-r border-gray-200 bg-white p-3 flex flex-col gap-3 overflow-y-auto">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">{t('surfacesHeading')}</div>
        <div className="flex flex-col gap-1">{SURFACE_TYPES.map(tile)}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">{t('objectsHeading')}</div>
        <div className="flex flex-col gap-1">{OBJECT_TYPES.map(tile)}</div>
      </div>
      <p className="text-[11px] text-gray-500 mt-2 leading-snug">{t('instructions')}</p>
    </div>
  )
}
