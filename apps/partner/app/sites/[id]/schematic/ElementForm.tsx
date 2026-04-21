'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { LayoutElementProps } from '@/types/shared'

interface Props {
  element: LayoutElementProps
  onPatch: (patch: Partial<LayoutElementProps>) => void
  onDelete: () => void
  onClose?: () => void
}

export default function ElementForm({ element, onPatch, onDelete, onClose }: Props) {
  const t = useTranslations('SiteSchematic')
  const [label, setLabel] = useState(element.label ?? '')
  const [shape, setShape] = useState<string>(element.shape ?? 'rect')
  const [cornerRadius, setCornerRadius] = useState(element.cornerRadius ?? 0)
  const [width, setWidth] = useState(element.width)
  const [height, setHeight] = useState(element.height)
  const [rotation, setRotation] = useState(element.rotation)
  const [color, setColor] = useState(element.color ?? '')

  useEffect(() => {
    setLabel(element.label ?? '')
    setShape(element.shape ?? 'rect')
    setCornerRadius(element.cornerRadius ?? 0)
    setWidth(element.width)
    setHeight(element.height)
    setRotation(element.rotation)
    setColor(element.color ?? '')
  }, [element.id])

  function commit(patch: Partial<LayoutElementProps>) {
    onPatch(patch)
  }

  return (
    <div className="p-4 flex flex-col gap-3 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementType')}</div>
          <div className="font-medium capitalize">{element.type}</div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 leading-none text-xl px-2 -mr-2 -mt-1"
          >
            ×
          </button>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementLabel')}</span>
        <input
          type="text"
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => commit({ label: label.trim() || null })}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementShape')}</span>
        <select
          value={shape}
          onChange={(e) => {
            const v = e.target.value as 'rect' | 'ellipse'
            setShape(v)
            commit({ shape: v })
          }}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="rect">{t('shapeRect')}</option>
          <option value="ellipse">{t('shapeEllipse')}</option>
        </select>
      </label>

      {shape === 'rect' ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementCornerRadius')}</span>
          <input
            type="number"
            step="0.5"
            min="0"
            max="50"
            value={cornerRadius}
            onChange={(e) => setCornerRadius(parseFloat(e.target.value) || 0)}
            onBlur={() => commit({ cornerRadius })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementWidth')}</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={width}
            onChange={(e) => setWidth(parseFloat(e.target.value) || 0)}
            onBlur={() => commit({ width })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementHeight')}</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={height}
            onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
            onBlur={() => commit({ height })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementRotation')}</span>
        <input
          type="number"
          step="15"
          min="-360"
          max="360"
          value={rotation}
          onChange={(e) => setRotation(parseFloat(e.target.value) || 0)}
          onBlur={() => commit({ rotation })}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">{t('elementColor')}</span>
        <input
          type="text"
          placeholder="#rrggbb"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          onBlur={() => commit({ color: color.trim() || null })}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </label>

      <button
        onClick={onDelete}
        className="mt-2 px-3 py-2 text-xs text-red-700 border border-red-300 rounded hover:bg-red-50"
      >
        {t('deleteElement')}
      </button>
    </div>
  )
}
