'use client'

import React, { useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import GridOnIcon from '@mui/icons-material/GridOn'
import EditIcon from '@mui/icons-material/Edit'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import QRPrintButton from './qr-print-button'
import { useSite } from '@/app/sites/site-context'
import { getParcelColor } from './chair-util'
import { formatSeat } from '@repo/data/seat-label'

interface InventoryToolbarProps {
  creating: boolean
  creatingParcel: boolean
  selectedItemCount: number
  selectedParcelGroup: number | null
  selectedParcelTotal: number
  isCompleteParcelSelected: boolean
  allParcelNumbers: number[]
  onStartCreate: () => void
  onStartParcel: () => void
  onCancel: () => void
  onDeleteSelected: () => void
  onClearSelection: () => void
  onRotateSelected: (delta: number) => void
  onAdjustSpacing: (axis: 'horizontal' | 'vertical', factor: number) => void
  onAssignToParcel: (group: number) => void
  onRemoveFromParcel: () => void
  onSelectEntireParcel: (group: number) => void
  onParcelReorder: () => void
  onEditParcelFull: () => void
  // Single-item selection — required so both editors must wire every tool.
  // The single-sunbed bar only renders when selectedSingleItemId is truthy.
  selectedSingleItemId: string | null
  selectedSingleItemNumber: number | null
  selectedSingleItemLabel: string | null
  selectedSingleItemParcelColor: string | null
  selectedSingleItemHasPair: boolean
  isEditPanelOpen: boolean
  onRotateSingle: (delta: number) => void
  onEditSingle: () => void
  onDeleteSingle: () => void
}

export default function InventoryToolbar({
  creating,
  creatingParcel,
  selectedItemCount,
  selectedParcelGroup,
  selectedParcelTotal,
  isCompleteParcelSelected,
  allParcelNumbers,
  onStartCreate,
  onStartParcel,
  onCancel,
  onDeleteSelected,
  onClearSelection,
  onRotateSelected,
  onAdjustSpacing,
  onAssignToParcel,
  onRemoveFromParcel,
  onSelectEntireParcel,
  onParcelReorder,
  onEditParcelFull,
  selectedSingleItemId,
  selectedSingleItemNumber,
  selectedSingleItemLabel,
  selectedSingleItemParcelColor,
  selectedSingleItemHasPair,
  isEditPanelOpen,
  onRotateSingle,
  onEditSingle,
  onDeleteSingle,
}: InventoryToolbarProps) {
  const { site } = useSite()
  const [assignMenuAnchor, setAssignMenuAnchor] = useState<null | HTMLElement>(null)
  const nextGroup = allParcelNumbers.length > 0 ? Math.max(...allParcelNumbers) + 1 : 1

  const parcelColor = selectedParcelGroup ? getParcelColor(selectedParcelGroup) : undefined

  // Creating state — instruction + cancel
  if (creating || creatingParcel) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-green-50 border border-green-200 rounded text-sm">
        <span className="text-green-700 font-medium">
          {creating ? 'Click on the map to place a new sunbed' : 'Click on the map to place the new parcel'}
        </span>
        <Button
          size="small"
          startIcon={<CloseIcon fontSize="small" />}
          onClick={onCancel}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          Cancel
        </Button>
      </div>
    )
  }

  // Selection state — unified single row
  if (selectedItemCount > 0) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm flex-wrap">
        {/* Selection badge */}
        <div className="flex items-center gap-1.5 mr-1">
          {parcelColor && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: parcelColor }} />
          )}
          {selectedParcelGroup != null ? (
            <>
              <span className="font-medium text-blue-800">
                Parcel {selectedParcelGroup}
              </span>
              <span className="text-blue-400">·</span>
              <span className="text-blue-600">
                {isCompleteParcelSelected
                  ? `${selectedItemCount} seat${selectedItemCount !== 1 ? 's' : ''}`
                  : `${selectedItemCount} of ${selectedParcelTotal}`}
              </span>
              {!isCompleteParcelSelected && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => onSelectEntireParcel(selectedParcelGroup)}
                  sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0, px: 0.5, minWidth: 0, color: 'primary.main' }}
                >
                  Select all
                </Button>
              )}
            </>
          ) : (
            <span className="font-medium text-blue-800">
              {selectedItemCount} seat{selectedItemCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <span className="text-blue-200">|</span>

        {/* Rotate */}
        <Tooltip title="Rotate −5°">
          <IconButton size="small" onClick={() => onRotateSelected(-5)} sx={{ p: 0.5 }}>
            <RotateLeftIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Rotate +5°">
          <IconButton size="small" onClick={() => onRotateSelected(5)} sx={{ p: 0.5 }}>
            <RotateRightIcon sx={{ fontSize: '1rem' }} />
          </IconButton>
        </Tooltip>

        {selectedItemCount > 1 && (
          <>
            <span className="text-blue-200">|</span>

            {/* Horizontal spacing */}
            <Tooltip title="Decrease horizontal spacing">
              <IconButton size="small" onClick={() => onAdjustSpacing('horizontal', 0.9)} sx={{ p: 0.5 }}>
                <SwapHorizIcon sx={{ fontSize: '1rem', opacity: 0.5 }} />
              </IconButton>
            </Tooltip>
            <span className="text-[10px] text-blue-500">H</span>
            <Tooltip title="Increase horizontal spacing">
              <IconButton size="small" onClick={() => onAdjustSpacing('horizontal', 1.1)} sx={{ p: 0.5 }}>
                <SwapHorizIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>

            <span className="text-blue-200">|</span>

            {/* Vertical spacing */}
            <Tooltip title="Decrease vertical spacing">
              <IconButton size="small" onClick={() => onAdjustSpacing('vertical', 0.9)} sx={{ p: 0.5 }}>
                <SwapVertIcon sx={{ fontSize: '1rem', opacity: 0.5 }} />
              </IconButton>
            </Tooltip>
            <span className="text-[10px] text-blue-500">V</span>
            <Tooltip title="Increase vertical spacing">
              <IconButton size="small" onClick={() => onAdjustSpacing('vertical', 1.1)} sx={{ p: 0.5 }}>
                <SwapVertIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
          </>
        )}

        <span className="text-blue-200">|</span>

        <span className="text-[10px] text-blue-400">Click map to move · ⌘+click toggle</span>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-1">
          {/* Complete parcel: restore order + edit */}
          {isCompleteParcelSelected && selectedParcelGroup != null && (
            <>
              <Tooltip title="Restore grid formation">
                <IconButton size="small" onClick={onParcelReorder} sx={{ p: 0.5 }}>
                  <GridOnIcon sx={{ fontSize: '1rem' }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Edit parcel config">
                <IconButton size="small" onClick={onEditParcelFull} sx={{ p: 0.5 }}>
                  <EditIcon sx={{ fontSize: '1rem' }} />
                </IconButton>
              </Tooltip>
              <span className="text-blue-200">|</span>
            </>
          )}

          {/* Non-complete parcel: assign / remove */}
          {!isCompleteParcelSelected && (
            <>
              <Button
                size="small"
                variant="text"
                onClick={(e) => setAssignMenuAnchor(e.currentTarget)}
                sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0, px: 0.5, minWidth: 0 }}
              >
                Assign ▾
              </Button>
              <Menu
                anchorEl={assignMenuAnchor}
                open={Boolean(assignMenuAnchor)}
                onClose={() => setAssignMenuAnchor(null)}
              >
                {allParcelNumbers.map(num => (
                  <MenuItem
                    key={num}
                    onClick={() => { onAssignToParcel(num); setAssignMenuAnchor(null) }}
                    sx={{ fontSize: '0.8rem' }}
                  >
                    Parcel {num}
                  </MenuItem>
                ))}
                {allParcelNumbers.length > 0 && <Divider />}
                <MenuItem
                  onClick={() => { onAssignToParcel(nextGroup); setAssignMenuAnchor(null) }}
                  sx={{ fontSize: '0.8rem', color: 'primary.main' }}
                >
                  + New parcel ({nextGroup})
                </MenuItem>
              </Menu>
              {selectedParcelGroup != null && (
                <Button
                  size="small"
                  variant="text"
                  onClick={onRemoveFromParcel}
                  sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0, px: 0.5, minWidth: 0, color: 'text.secondary' }}
                >
                  Ungroup
                </Button>
              )}
              <span className="text-blue-200">|</span>
            </>
          )}

          <Tooltip title="Delete selected">
            <IconButton size="small" color="error" onClick={onDeleteSelected} sx={{ p: 0.5 }}>
              <DeleteOutlineIcon sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          <button
            className="text-[10px] text-gray-400 hover:text-gray-600 underline ml-1"
            onClick={onClearSelection}
          >
            Deselect
          </button>
        </div>
      </div>
    )
  }

  // Single-sunbed selection — same blue pill row as multi-selection, different controls
  if (selectedSingleItemId) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm flex-wrap">
        <div className="flex items-center gap-1.5 mr-1">
          {selectedSingleItemParcelColor && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selectedSingleItemParcelColor }}
            />
          )}
          <span className="font-medium text-blue-800">
            {selectedSingleItemNumber != null
              ? `Sunbed ${formatSeat({ seatLabel: selectedSingleItemLabel, number: selectedSingleItemNumber }, { parcel: true })}`
              : 'Sunbed'}
          </span>
          {selectedSingleItemHasPair && (
            <>
              <span className="text-blue-400">·</span>
              <span className="text-blue-600 text-xs">paired</span>
            </>
          )}
        </div>

        <span className="text-blue-200">|</span>

        <>
          <Tooltip title="Rotate −15°">
            <IconButton size="small" onClick={() => onRotateSingle(-15)} sx={{ p: 0.5 }}>
              <RotateLeftIcon sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Rotate +15°">
            <IconButton size="small" onClick={() => onRotateSingle(15)} sx={{ p: 0.5 }}>
              <RotateRightIcon sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          <span className="text-blue-200">|</span>
        </>

        {/* Track 021 P2: pair / depair removed. Seats are created as units (a
            hand-placed unit is a pair), never assembled from loose beds — so a
            mis-grouped unit is deleted and placed again rather than split. */}

        <div className="ml-auto flex items-center gap-1">
          <Tooltip title="Edit sunbed">
            <IconButton
              size="small"
              onClick={onEditSingle}
              sx={{ p: 0.5, color: isEditPanelOpen ? 'primary.main' : undefined }}
            >
              <EditIcon sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete sunbed">
            <IconButton size="small" color="error" onClick={onDeleteSingle} sx={{ p: 0.5 }}>
              <DeleteOutlineIcon sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
          <button
            className="text-[10px] text-gray-400 hover:text-gray-600 underline ml-1"
            onClick={onClearSelection}
          >
            Deselect
          </button>
        </div>
      </div>
    )
  }

  // Idle state — add buttons + hint
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button
        variant="outlined"
        size="small"
        onClick={onStartParcel}
        sx={{ textTransform: 'none' }}
      >
        + Add Parcel
      </Button>
      <Button
        variant="text"
        size="small"
        onClick={onStartCreate}
        sx={{ textTransform: 'none', color: 'text.secondary' }}
      >
        + Single item
      </Button>
      <span className="text-xs text-gray-400 ml-1">
        ⇧ Shift+drag to select · ⌘+click to multi-select
      </span>
      <div className="ml-auto">
        <QRPrintButton siteId={site.id!} label="Print QR Codes" items={site.inventoryItems!} />
      </div>
    </div>
  )
}
