'use client'

import { useTranslations } from 'next-intl'
import { AREA_TYPES, POI_TYPES, beachPalette } from './palette'

const LABEL_KEY: Record<string, string> = {
  water: 'areaWater',
  sand: 'areaSand',
  pool: 'areaPool',
  grass: 'areaGrass',
  deck: 'areaDeck',
  bar: 'poiBar',
  reception: 'poiReception',
  shower: 'poiShower',
  restroom: 'poiRestroom',
  lifeguard: 'poiLifeguard',
}

interface Props {
  pendingType: string | null
  onPickType: (type: string | null) => void
  onAddSunbed: () => void
  onAddParcel: () => void
}

export default function ElementPalette({ pendingType, onPickType, onAddSunbed, onAddParcel }: Props) {
  const t = useTranslations('SiteSchematic')

  function tile(type: string) {
    const visual = beachPalette[type]
    const active = pendingType === type
    const labelKey = LABEL_KEY[type] ?? type
    return (
      <button
        key={type}
        onClick={() => onPickType(active ? null : type)}
        className={`flex items-center gap-2 px-3 py-2 rounded text-xs border transition-colors w-full ${
          active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
        }`}
      >
        <span
          className="inline-block w-4 h-4 rounded"
          style={{ background: visual?.fill, border: `1px solid ${visual?.stroke ?? '#1f2937'}` }}
        />
        <span>{t(labelKey)}</span>
      </button>
    )
  }

  return (
    <div className="w-56 border-r border-gray-200 bg-white p-3 flex flex-col gap-3 overflow-y-auto">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">{t('areasHeading')}</div>
        <div className="flex flex-col gap-1">{AREA_TYPES.map(tile)}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">{t('poisHeading')}</div>
        <div className="flex flex-col gap-1">{POI_TYPES.map(tile)}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">{t('sunbedsHeading')}</div>
        <div className="flex flex-col gap-1">
          <button
            onClick={onAddSunbed}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs border border-gray-200 hover:bg-gray-50"
          >
            <span className="inline-block w-4 h-4 rounded bg-amber-300 border border-amber-700" />
            <span>{t('addSunbed')}</span>
          </button>
          <button
            onClick={onAddParcel}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs border border-gray-200 hover:bg-gray-50"
          >
            <span className="inline-block w-4 h-4 rounded bg-amber-500 border border-amber-700" />
            <span>{t('addParcel')}</span>
          </button>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 mt-2 leading-snug">{t('instructions')}</p>
    </div>
  )
}
