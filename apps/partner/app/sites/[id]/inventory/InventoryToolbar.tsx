'use client'

import React from 'react'
import Button from '@mui/material/Button'
import CloseIcon from '@mui/icons-material/Close'

interface InventoryToolbarProps {
  creating: boolean
  creatingParcel: boolean
  selectedItemId: string | null
  deleteMode: boolean
  onStartCreate: () => void
  onStartParcel: () => void
  onCancel: () => void
  onPrintAll: () => void
  onToggleDeleteMode: () => void
}


export default function InventoryToolbar({
  creating,
  creatingParcel,
  selectedItemId,
  deleteMode,
  onStartCreate,
  onStartParcel,
  onCancel,
  onPrintAll,
  onToggleDeleteMode
}: InventoryToolbarProps) {
  const isIdle = !creating && !selectedItemId

  return (
    <div className="flex justify-between mt-4 mb-6">
      {isIdle ? (
        <div className="flex gap-2">
          <Button variant="outlined" onClick={onStartCreate}>
            + Add Item
          </Button>
          <Button variant="outlined" onClick={onStartParcel}>
            + Add Parcel
          </Button>
          <Button
            variant={deleteMode ? 'contained' : 'outlined'}
            color={deleteMode ? 'error' : 'inherit'}
            onClick={onToggleDeleteMode}
          >
            {deleteMode ? 'Exit Delete Mode' : 'Delete Seats'}
          </Button>
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

      <Button variant="outlined" onClick={onPrintAll}>
        Print all QR Codes
      </Button>
    </div>
  )
}
