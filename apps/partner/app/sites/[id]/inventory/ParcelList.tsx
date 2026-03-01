'use client'

import React from 'react'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import GridOnIcon from '@mui/icons-material/GridOn'
import { getParcelColor } from './chair-util'
import { InventoryItem } from '@/types/shared'

interface ParcelListProps {
  inventory: InventoryItem[]
  allParcelNumbers: number[]
  selectedItemIds: string[]
  onSelectParcel: (group: number) => void
  onRestoreOrder: (group: number) => void
}

export default function ParcelList({
  inventory,
  allParcelNumbers,
  selectedItemIds,
  onSelectParcel,
  onRestoreOrder,
}: ParcelListProps) {
  if (allParcelNumbers.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 bg-white border-b border-gray-100 overflow-x-auto">
      <span className="text-xs text-gray-400 mr-1 shrink-0">Parcels</span>
      {allParcelNumbers.map(group => {
        const parcelItems = inventory.filter(i => i.group === group)
        const count = parcelItems.length
        const color = getParcelColor(group) || '#6b7280'
        const parcelItemIds = parcelItems.map(i => i.id)
        const allSelected = parcelItemIds.length > 0 && parcelItemIds.every(id => selectedItemIds.includes(id))

        return (
          <div
            key={group}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer shrink-0
              border transition-all text-xs
              ${allSelected
                ? 'border-blue-400 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300'}
            `}
            onClick={() => onSelectParcel(group)}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className={`font-medium ${allSelected ? 'text-blue-700' : 'text-gray-700'}`}>
              {group}
            </span>
            <span className={`${allSelected ? 'text-blue-500' : 'text-gray-400'}`}>
              ({count})
            </span>
            <Tooltip title="Restore grid order" arrow>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  onRestoreOrder(group)
                }}
                sx={{
                  p: 0.25,
                  ml: 0.25,
                  '& .MuiSvgIcon-root': { fontSize: '0.85rem' },
                }}
              >
                <GridOnIcon fontSize="small" sx={{ color: allSelected ? '#3b82f6' : '#9ca3af' }} />
              </IconButton>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}
