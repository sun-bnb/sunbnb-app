'use client'

import React, { useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { InventoryItem } from '@/types/shared'
import { deleteInventoryItem, saveInventoryItemProperties } from '../actions'
import QRPrintButton from './qr-print-button'
import { useSharedMap } from './SharedMapContext'
import { useSite } from '@/app/sites/site-context'

interface InventoryFormProps {
  selectedItem: InventoryItem
  onSave: () => void
  onDelete: () => void
  onPair: () => void
  onEditGroup: (group: number) => void
}

export default function InventoryForm({
  selectedItem,
  onSave,
  onDelete,
  onPair,
  onEditGroup
}: InventoryFormProps) {

  const { setValue, values } = useSharedMap()
  const { site } = useSite()
  
  const [selectedItemNumber, setSelectedItemNumber] = useState('')
  const [selectedItemGroup, setSelectedItemGroup] = useState('')
  const [selectedItemLabel, setSelectedItemLabel] = useState('')
  const [selectedItemCategory, setSelectedItemCategory] = useState('')
  const [selectedItemPrice, setSelectedItemPrice] = useState('')
  const [selectedItemRotation, setSelectedItemRotation] = useState('')

  // 6) Field‐change helper
  const handleFieldChange = (field: string, value: string) => {
    switch (field) {
      case 'number': setSelectedItemNumber(value); break
      case 'group':  setSelectedItemGroup(value); break
      case 'label':  setSelectedItemLabel(value); break
      case 'category': setSelectedItemCategory(value); break
      case 'price':  setSelectedItemPrice(value); break
      case 'rotation': setSelectedItemRotation(value); break
      case 'pairId': setValue('selectedItemPairId', value); break
    }
  }

  // 7) “Save” / “Delete” / “Print” / “Pair” handlers
  const handleSave = () => {
    if (!selectedItem) return
    const changedValues: Record<string, any> = {}
    if (selectedItemNumber) changedValues.number = Number(selectedItemNumber)
    if (selectedItemGroup) changedValues.group = Number(selectedItemGroup)
    if (selectedItemLabel) changedValues.label = selectedItemLabel
    if (selectedItemCategory) changedValues.category = selectedItemCategory
    if (selectedItemPrice) changedValues.price = Number(selectedItemPrice)
    if (selectedItemRotation) changedValues.rotation = Number(selectedItemRotation)
    if (values.selectedItemPairId) changedValues.pairId = values.selectedItemPairId
    saveInventoryItemProperties(selectedItem.id, changedValues)
    onSave()
  }

  const handleDelete = () => {
    if (!selectedItem) return
    deleteInventoryItem(selectedItem.id)
    onDelete()
  }

  const handlePrint = () => {
    if (!selectedItem) return
    // QrPrintButton covers printing itself
  }

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
          onChange={(e) => handleFieldChange('number', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-group"
          label="Item Group"
          fullWidth
          value={selectedItemGroup || String(selectedItem.group) || ''}
          variant="standard"
          placeholder="0"
          onChange={(e) => handleFieldChange('group', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-label"
          label="Item Label"
          fullWidth
          value={selectedItemLabel || selectedItem.label || ''}
          variant="standard"
          placeholder="Sunbed A"
          onChange={(e) => handleFieldChange('label', e.target.value)}
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
          onChange={(e) => handleFieldChange('category', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-price"
          label="Item Price"
          fullWidth
          value={selectedItemPrice || selectedItem.price?.toString() || ''}
          variant="standard"
          placeholder="8.5"
          onChange={(e) => handleFieldChange('price', e.target.value)}
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
          onChange={(e) => handleFieldChange('rotation', e.target.value)}
          sx={{ mr: 1 }}
        />
        <TextField
          name="item-pairing"
          label="Item Pairing"
          fullWidth
          value={values.selectedItemPairId || selectedItem.pairId || selectedItem.pairedBy?.id || ''}
          variant="standard"
          placeholder="Pair ID"
          onChange={(e) => handleFieldChange('pairId', e.target.value)}
          sx={{ mr: 1 }}
        />
      </div>
      <div className="flex justify-between">
        <div className="flex items-center gap-2">
          <Button variant="contained" onClick={handleSave}>
            Save
          </Button>
          <Button variant="outlined" color="error" onClick={handleDelete}>
            Delete
          </Button>
          <Button variant="outlined" onClick={() => {
            if (selectedItem.status === 'disabled') {
              saveInventoryItemProperties(selectedItem.id, { status: 'active' })
                .then((result) => {
                  if (result.status === 'ok') {
                    selectedItem.status = 'active'
                  }
                })
            } else {
              saveInventoryItemProperties(selectedItem.id, { status: 'disabled' }).then((result) => {
                if (result.status === 'ok') {
                  selectedItem.status = 'disabled'
                }
              })
            }
          }}>
            { selectedItem.status === 'disabled' ? 'Enable' : 'Disable' }
          </Button>
          <QRPrintButton siteId={site.id!} label="QR Code" items={[selectedItem]}/>
          <Button variant="outlined" onClick={onPair}>
            PAIR
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outlined" onClick={() => {
            console.log('selectedItem.group)', selectedItem)
            if (selectedItem?.group) {
              onEditGroup(selectedItem.group)
            }
          }}>
            Edit group
          </Button>
        </div>
        
      </div>
    </div>
  )
}
