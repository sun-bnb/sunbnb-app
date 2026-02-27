'use client'

import React from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import EditIcon from '@mui/icons-material/Edit'
import GridOnIcon from '@mui/icons-material/GridOn'
import QRPrintButton from './qr-print-button'
import { useSite } from '@/app/sites/site-context'
import { ChairConfig } from './chair-util'

interface InventoryToolbarProps {
  creating: boolean
  creatingParcel: boolean
  selectedItemId: string | null
  selectedItemCount: number
  parcelConfig: ChairConfig | null
  onStartCreate: () => void
  onStartParcel: () => void
  onCancel: () => void
  onDeleteSelected: () => void
  onClearSelection: () => void
  onParcelAdjust: (field: keyof ChairConfig, delta: number) => void
  onParcelReorder: () => void
  onEditParcelFull: () => void
}


export default function InventoryToolbar({
  creating,
  creatingParcel,
  selectedItemId,
  selectedItemCount,
  parcelConfig,
  onStartCreate,
  onStartParcel,
  onCancel,
  onDeleteSelected,
  onClearSelection,
  onParcelAdjust,
  onParcelReorder,
  onEditParcelFull,
}: InventoryToolbarProps) {

  const isIdle = !creating && !creatingParcel && !selectedItemId

  const { site } = useSite()

  return (
    <div className="flex flex-col gap-2 mt-4 mb-6">
      <div className="flex justify-between items-center">
        {isIdle ? (
          <div className="flex gap-2 items-center">
            <Button variant="outlined" onClick={onStartCreate}>
              + Add Item
            </Button>
            <Button variant="outlined" onClick={onStartParcel}>
              + Add Parcel
            </Button>
            <span className="text-xs text-gray-400 ml-2">
              ⇧ Shift+drag to select
            </span>
          </div>
        ) : (
          <Button
            startIcon={<CloseIcon />}
            variant="text"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        <QRPrintButton siteId={site.id!} label="Print all QR Codes" items={site.inventoryItems!}/>
      </div>

      {selectedItemCount > 0 && (
        <div className="flex flex-col gap-2">
          {/* Selection info bar */}
          <div className="flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded">
            <span className="text-sm font-medium text-blue-800">
              {selectedItemCount} seat{selectedItemCount !== 1 ? 's' : ''} selected
            </span>
            <span className="text-blue-300">|</span>
            <span className="text-xs text-blue-600">
              Click map to move
            </span>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={onDeleteSelected}
            >
              Delete
            </Button>
            <button
              className="ml-auto text-sm text-gray-500 hover:text-gray-700 underline"
              onClick={onClearSelection}
            >
              Deselect
            </button>
          </div>

          {/* Parcel controls — shown when all selected items are from one group */}
          {parcelConfig && (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded flex-wrap">
              <span className="text-xs font-medium text-purple-700 mr-1">
                Parcel {parcelConfig.group}
              </span>

              <span className="text-purple-300 mx-1">|</span>

              <Tooltip title="Rotate −5°">
                <IconButton size="small" onClick={() => onParcelAdjust('rotation', -5)}>
                  <RotateLeftIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <span className="text-xs text-purple-600 min-w-[32px] text-center">
                {parcelConfig.rotation}°
              </span>
              <Tooltip title="Rotate +5°">
                <IconButton size="small" onClick={() => onParcelAdjust('rotation', 5)}>
                  <RotateRightIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <span className="text-purple-300 mx-1">|</span>

              <Tooltip title="Decrease horizontal gap">
                <IconButton size="small" onClick={() => onParcelAdjust('horizontalGap', -0.2)}>
                  <SwapHorizIcon fontSize="small" sx={{ opacity: 0.5 }} />
                </IconButton>
              </Tooltip>
              <span className="text-xs text-purple-600 min-w-[36px] text-center">
                H {parcelConfig.horizontalGap.toFixed(1)}
              </span>
              <Tooltip title="Increase horizontal gap">
                <IconButton size="small" onClick={() => onParcelAdjust('horizontalGap', 0.2)}>
                  <SwapHorizIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <span className="text-purple-300 mx-1">|</span>

              <Tooltip title="Decrease vertical gap">
                <IconButton size="small" onClick={() => onParcelAdjust('verticalGap', -0.5)}>
                  <SwapVertIcon fontSize="small" sx={{ opacity: 0.5 }} />
                </IconButton>
              </Tooltip>
              <span className="text-xs text-purple-600 min-w-[36px] text-center">
                V {parcelConfig.verticalGap.toFixed(1)}
              </span>
              <Tooltip title="Increase vertical gap">
                <IconButton size="small" onClick={() => onParcelAdjust('verticalGap', 0.5)}>
                  <SwapVertIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              {parcelConfig.pairSeats && (
                <>
                  <span className="text-purple-300 mx-1">|</span>
                  <Tooltip title="Decrease pair gap">
                    <IconButton size="small" onClick={() => onParcelAdjust('intraPairGap', -0.2)}>
                      <SwapHorizIcon fontSize="small" sx={{ opacity: 0.5, transform: 'scale(0.8)' }} />
                    </IconButton>
                  </Tooltip>
                  <span className="text-xs text-purple-600 min-w-[36px] text-center">
                    P {parcelConfig.intraPairGap.toFixed(1)}
                  </span>
                  <Tooltip title="Increase pair gap">
                    <IconButton size="small" onClick={() => onParcelAdjust('intraPairGap', 0.2)}>
                      <SwapHorizIcon fontSize="small" sx={{ transform: 'scale(0.8)' }} />
                    </IconButton>
                  </Tooltip>
                </>
              )}

              <span className="text-purple-300 mx-1">|</span>

              <Button
                size="small"
                variant="outlined"
                startIcon={<GridOnIcon />}
                onClick={onParcelReorder}
                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
              >
                Reorder
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={onEditParcelFull}
                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
              >
                Edit Details
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
