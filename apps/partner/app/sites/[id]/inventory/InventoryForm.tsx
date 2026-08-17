'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import Collapse from '@mui/material/Collapse'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import SyncIcon from '@mui/icons-material/Sync'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { InventoryItem } from '@/types/shared'
import { deleteInventoryItem, saveInventoryItemProperties } from '../inventory-actions'
import { getSite } from '../queries'
import { getParcelColor } from './chair-util'
import QRPrintButton from './qr-print-button'
import { useSite } from '@/app/sites/site-context'
import PriceBreakdown from '@/components/PriceBreakdown'
import { formatSeatId } from '@repo/data/seat-label'

interface InventoryFormProps {
  selectedItem: InventoryItem
  onDelete: () => void
  onEditGroup: (item: InventoryItem) => void
  onClose: () => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function InventoryForm({
  selectedItem,
  onDelete,
  onEditGroup,
  onClose,
}: InventoryFormProps) {

  const { site, setSite } = useSite()

  const [label, setLabel] = useState(selectedItem.label || '')
  const [price, setPrice] = useState(selectedItem.price?.toString() || '')
  const [isEnabled, setIsEnabled] = useState(selectedItem.status !== 'disabled')

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [itemNumber, setItemNumber] = useState(String(selectedItem.number) || '')
  const [itemGroup, setItemGroup] = useState(String(selectedItem.group) || '')
  const [rotation, setRotation] = useState(selectedItem.rotation?.toString() || '0')
  const [category, setCategory] = useState(selectedItem.category || '')

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLabel(selectedItem.label || '')
    setPrice(selectedItem.price?.toString() || '')
    setIsEnabled(selectedItem.status !== 'disabled')
    setItemNumber(String(selectedItem.number) || '')
    setItemGroup(String(selectedItem.group) || '')
    setRotation(selectedItem.rotation?.toString() || '0')
    setCategory(selectedItem.category || '')
    setSaveStatus('idle')
  }, [selectedItem.id])

  const doSave = useCallback(async (values: Record<string, any>) => {
    setSaveStatus('saving')
    try {
      const result = await saveInventoryItemProperties(selectedItem.id, values)
      if (result.status === 'ok') {
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
        const updatedSite = await getSite(site.id!)
        if (updatedSite) setSite(updatedSite)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }, [selectedItem.id, site.id])

  const scheduleSave = useCallback((values: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSave(values), 1500)
  }, [doSave])

  const immediateSave = useCallback((values: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSave(values)
  }, [doSave])

  const handleDelete = async () => {
    await deleteInventoryItem(selectedItem.id)
    onDelete()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            Sunbed #{formatSeatId(selectedItem, { parcel: true })}
          </h3>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            {selectedItem.group > 0 && (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: getParcelColor(selectedItem.group) || '#9ca3af' }}
              />
            )}
            {selectedItem.group > 0 ? `Parcel ${selectedItem.group}` : 'No parcel'}
          </span>
        </div>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </div>

      {/* Save indicator */}
      <div className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border-b transition-all ${
        saveStatus === 'saving' ? 'bg-blue-50 text-blue-600 border-blue-100' :
        saveStatus === 'saved' ? 'bg-green-50 text-green-600 border-green-100' :
        saveStatus === 'error' ? 'bg-red-50 text-red-600 border-red-100' :
        'bg-white text-gray-400 border-gray-100'
      }`}>
        {saveStatus === 'saving' && <><SyncIcon sx={{ fontSize: 14 }} className="animate-spin" /> Saving&hellip;</>}
        {saveStatus === 'saved' && <><CloudDoneIcon sx={{ fontSize: 14 }} /> Saved</>}
        {saveStatus === 'error' && <><WarningAmberIcon sx={{ fontSize: 14 }} /> Error</>}
        {saveStatus === 'idle' && <><CloudDoneIcon sx={{ fontSize: 14 }} /> Up to date</>}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">

        {/* Label */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-600 mb-1 block">Label</label>
          <TextField
            fullWidth
            size="small"
            value={label}
            placeholder="e.g. A1, VIP Left"
            onChange={e => {
              setLabel(e.target.value)
              scheduleSave({ label: e.target.value })
            }}
          />
        </div>

        {/* Price */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-600 mb-1 block">Price (&euro;)</label>
          <TextField
            fullWidth
            size="small"
            type="number"
            value={price}
            placeholder="e.g. 15"
            onChange={e => {
              setPrice(e.target.value)
              if (e.target.value !== '') {
                scheduleSave({ price: parseFloat(e.target.value) })
              }
            }}
          />
          <PriceBreakdown price={price} site={site} />
        </div>

        {/* Status toggle */}
        <div className={`flex items-center justify-between rounded-lg border p-3 mb-4 ${
          isEnabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
        }`}>
          <div>
            <div className={`text-sm font-medium ${isEnabled ? 'text-green-700' : 'text-gray-600'}`}>
              {isEnabled ? 'Active' : 'Disabled'}
            </div>
            <div className="text-xs text-gray-500">
              {isEnabled ? 'Visible to customers' : 'Hidden from booking'}
            </div>
          </div>
          <Switch
            size="small"
            checked={isEnabled}
            color="success"
            onChange={() => {
              const newStatus = isEnabled ? 'disabled' : 'active'
              setIsEnabled(!isEnabled)
              immediateSave({ status: newStatus })
            }}
          />
        </div>

        <Divider sx={{ mb: 2 }} />

        {/* Quick actions */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <QRPrintButton siteId={site.id!} label="QR Code" items={[selectedItem]} />
          {selectedItem.group > 0 && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => onEditGroup(selectedItem)}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              Edit parcel
            </Button>
          )}
        </div>

        <Divider sx={{ mb: 2 }} />

        {/* Advanced section */}
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 mb-2 w-full"
        >
          {advancedOpen ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
          Advanced
        </button>
        <Collapse in={advancedOpen}>
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-0.5 block">Number</label>
                <TextField fullWidth size="small" type="number" value={itemNumber}
                  onChange={e => { setItemNumber(e.target.value); if (e.target.value !== '') scheduleSave({ number: Number(e.target.value) }) }} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-0.5 block">Group</label>
                <TextField fullWidth size="small" type="number" value={itemGroup}
                  onChange={e => { setItemGroup(e.target.value); if (e.target.value !== '') scheduleSave({ group: Number(e.target.value) }) }} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-0.5 block">Rotation</label>
                <TextField fullWidth size="small" type="number" value={rotation}
                  onChange={e => { setRotation(e.target.value); if (e.target.value !== '') scheduleSave({ rotation: Number(e.target.value) }) }} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-0.5 block">Category</label>
                <TextField fullWidth size="small" value={category} placeholder="PRICE1"
                  onChange={e => { setCategory(e.target.value); scheduleSave({ category: e.target.value }) }} />
              </div>
            </div>
          </div>
        </Collapse>

        <Divider sx={{ mb: 2 }} />

        {/* Danger zone */}
        <div className="mt-2">
          <div className="rounded-lg border border-red-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-red-600">Delete sunbed</div>
                <div className="text-xs text-gray-500">Remove permanently</div>
              </div>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                onClick={handleDelete}
                sx={{ textTransform: 'none', fontSize: '0.7rem' }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
