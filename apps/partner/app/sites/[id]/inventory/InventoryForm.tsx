'use client'

import React from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { InventoryItem } from '@/types/shared'

interface InventoryFormProps {
  siteId: string
  selectedItem: InventoryItem
  selectedItemNumber: string
  selectedItemGroup: string
  selectedItemLabel: string
  selectedItemCategory: string
  selectedItemPrice: string
  selectedItemRotation: string
  selectedItemPairId: string
  onFieldChange: (
    field: 'number' | 'group' | 'label' | 'category' | 'price' | 'rotation' | 'pairId',
    value: string
  ) => void
  onSave: () => void
  onDelete: () => void
  onPrint: () => void
  onPair: () => void
}

export default function InventoryForm({
  siteId,
  selectedItem,
  selectedItemNumber,
  selectedItemGroup,
  selectedItemLabel,
  selectedItemCategory,
  selectedItemPrice,
  selectedItemRotation,
  selectedItemPairId,
  onFieldChange,
  onSave,
  onDelete,
  onPrint,
  onPair,
}: InventoryFormProps) {
  return (
    <div className="flex flex-col mt-[6px] ml-[4px]">
      <div className="flex mb-2">
        <TextField
          name="item-number"
          label="Item Number"
          fullWidth
          value={selectedItemNumber || String(selectedItem.number) || ''}
          variant="standard"
          placeholder="0001"
          onChange={(e) => onFieldChange('number', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-group"
          label="Item Group"
          fullWidth
          value={selectedItemGroup || String(selectedItem.group) || ''}
          variant="standard"
          placeholder="0"
          onChange={(e) => onFieldChange('group', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-label"
          label="Item Label"
          fullWidth
          value={selectedItemLabel || selectedItem.label || ''}
          variant="standard"
          placeholder="Sunbed A"
          onChange={(e) => onFieldChange('label', e.target.value)}
          sx={{ mr: 1 }}
        />
      </div>
      <div className="flex mb-2">
        <TextField
          name="item-category"
          label="Item Category"
          fullWidth
          value={selectedItemCategory || selectedItem.category || ''}
          variant="standard"
          placeholder="PRICE1"
          onChange={(e) => onFieldChange('category', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-price"
          label="Item Price"
          fullWidth
          value={selectedItemPrice || selectedItem.price?.toString() || ''}
          variant="standard"
          placeholder="8.5"
          onChange={(e) => onFieldChange('price', e.target.value)}
          sx={{ mr: 1 }}
        />
      </div>
      <div className="flex mb-2">
        <TextField
          name="item-rotation"
          label="Item Rotation"
          fullWidth
          value={selectedItemRotation || selectedItem.rotation?.toString() || ''}
          variant="standard"
          placeholder="0"
          onChange={(e) => onFieldChange('rotation', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-pairing"
          label="Item Pairing"
          fullWidth
          value={selectedItemPairId || selectedItem.pairId || selectedItem.pairedBy?.id || ''}
          variant="standard"
          placeholder="Pair ID"
          onChange={(e) => onFieldChange('pairId', e.target.value)}
          sx={{ mr: 1 }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="contained" onClick={onSave}>
          Save
        </Button>
        <Button variant="outlined" color="error" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="outlined" onClick={onPrint}>
          QR Code
        </Button>
        <Button variant="outlined" onClick={onPair}>
          PAIR
        </Button>
      </div>
    </div>
  )
}
