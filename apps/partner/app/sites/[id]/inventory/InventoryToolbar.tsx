'use client'

import React from 'react'
import Button from '@mui/material/Button'
import CloseIcon from '@mui/icons-material/Close'

interface InventoryToolbarProps {
  creating: boolean
  selectedItemId: string | null
  onStartCreate: () => void
  onCancel: () => void
  onPrintAll: () => void
}

export default function InventoryToolbar({
  creating,
  selectedItemId,
  onStartCreate,
  onCancel,
  onPrintAll,
}: InventoryToolbarProps) {
  return (
    <div className="flex justify-between mt-4 mb-6">
      { !creating && !selectedItemId ? (
        <Button variant="outlined" onClick={onStartCreate}>
          + Add Item
        </Button>
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
