// ParcelFormView.tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useSite } from '@/app/sites/site-context'
import { ChairConfig } from './chair-util'
import { syncChairsWithLayout, setItemStatusByGroup, reverseParcelNumbering } from './actions'
import { deleteItemsByGroup } from '../inventory-actions'
import { getSite } from '../queries'
import PriceBreakdown from '@/components/PriceBreakdown'

interface ParcelFormProps {
  siteId: string
  editGroup?: number | null
  mode: 'create' | 'edit'
  config: ChairConfig
  setConfig: React.Dispatch<React.SetStateAction<ChairConfig>>
  onCancel: () => void
  onDeleteParcel: (group: number) => void
}

export default function ParcelFormView({
  siteId,
  editGroup,
  mode,
  config,
  setConfig,
  onCancel,
  onDeleteParcel,
}: ParcelFormProps) {
  const { site, setSite } = useSite()

  const configRef = useRef(config)

  // String states so numeric fields can be cleared during editing
  const [rowsStr, setRowsStr] = useState(String(config.rows))
  const [seatsPerRowStr, setSeatsPerRowStr] = useState(String(config.seatsPerRow))
  const [horizontalGapStr, setHorizontalGapStr] = useState(String(config.horizontalGap))
  const [verticalGapStr, setVerticalGapStr] = useState(String(config.verticalGap))
  const [intraPairGapStr, setIntraPairGapStr] = useState(String(config.intraPairGap))
  const [rotationStr, setRotationStr] = useState(String(config.rotation))
  const [groupStr, setGroupStr] = useState(String(config.group))

  // Sync string states when a different parcel is loaded (editGroup changes)
  useEffect(() => {
    setRowsStr(String(config.rows))
    setSeatsPerRowStr(String(config.seatsPerRow))
    setHorizontalGapStr(String(config.horizontalGap))
    setVerticalGapStr(String(config.verticalGap))
    setIntraPairGapStr(String(config.intraPairGap))
    setRotationStr(String(config.rotation))
    setGroupStr(String(config.group))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editGroup])

  // Exclude pool seats (status:'pool') — they are managed from the manage page, not the inventory editor
  const parcelItems = (site.inventoryItems || []).filter(item => item.group === config.group && item.status !== 'pool')
  const activeItems = parcelItems.filter(item => item.status !== 'disabled')
  const allDisabled = parcelItems.length > 0 && activeItems.length === 0

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    if (mode === 'edit' && editGroup) {
      setConfig((prev) => ({ ...prev, group: editGroup }))
    }
  }, [mode, editGroup, setConfig])

  const handleConfigChange = (field: keyof ChairConfig, value: number | boolean | string | undefined) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handleApplyChanges = async () => {
    await syncChairsWithLayout(siteId, config, 'rearrange')
    const updatedSite = await getSite(siteId)
    setSite(updatedSite!)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            {mode === 'create' ? 'New Parcel' : `Parcel ${config.group}`}
          </h3>
          <span className="text-xs text-gray-500">
            {mode === 'create'
              ? `${config.rows} rows × ${config.seatsPerRow} seats = ${config.rows * config.seatsPerRow} sunbeds`
              : `${parcelItems.length} sunbed${parcelItems.length !== 1 ? 's' : ''}`
            }
          </span>
        </div>
        <IconButton size="small" onClick={onCancel}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">

        {/* Grid layout */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-600 mb-2 block">Grid layout</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Rows</label>
              <TextField
                fullWidth size="small" type="number"
                value={rowsStr}
                disabled={mode === 'edit'}
                onChange={(e) => { setRowsStr(e.target.value); if (e.target.value !== '') handleConfigChange('rows', Number(e.target.value)) }}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Seats/row</label>
              <TextField
                fullWidth size="small" type="number"
                value={seatsPerRowStr}
                disabled={mode === 'edit'}
                onChange={(e) => { setSeatsPerRowStr(e.target.value); if (e.target.value !== '') handleConfigChange('seatsPerRow', Number(e.target.value)) }}
              />
            </div>
          </div>
        </div>

        {/* Pair seats toggle */}
        <div className={`flex items-center justify-between rounded-lg border p-3 mb-4 ${
          config.pairSeats ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
        }`}>
          <div>
            <div className={`text-sm font-medium ${config.pairSeats ? 'text-blue-700' : 'text-gray-600'}`}>
              Pair seats
            </div>
            <div className="text-xs text-gray-500">
              Group seats in pairs
            </div>
          </div>
          <Switch
            size="small"
            checked={!!config.pairSeats}
            onChange={() => handleConfigChange('pairSeats', !config.pairSeats)}
          />
        </div>

        {/* Spacing */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-600 mb-2 block">Gaps (meters)</label>
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">{config.pairSeats ? 'Between pairs' : 'Horizontal'}</label>
              <TextField
                fullWidth size="small" type="number"
                value={horizontalGapStr}
                inputProps={{ step: 0.1 }}
                onChange={(e) => { setHorizontalGapStr(e.target.value); if (e.target.value !== '') handleConfigChange('horizontalGap', Number(e.target.value)) }}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Between rows</label>
              <TextField
                fullWidth size="small" type="number"
                value={verticalGapStr}
                inputProps={{ step: 0.5 }}
                onChange={(e) => { setVerticalGapStr(e.target.value); if (e.target.value !== '') handleConfigChange('verticalGap', Number(e.target.value)) }}
              />
            </div>
          </div>
        </div>

        {/* Rotation & pair gap */}
        <div className="flex gap-2 mb-4">
          {config.pairSeats && (
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Paired beds gap</label>
              <TextField
                fullWidth size="small" type="number"
                value={intraPairGapStr}
                inputProps={{ step: 0.1 }}
                onChange={(e) => { setIntraPairGapStr(e.target.value); if (e.target.value !== '') handleConfigChange('intraPairGap', Number(e.target.value)) }}
              />
            </div>
          )}
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-0.5 block">Rotation (°)</label>
            <TextField
              fullWidth size="small" type="number"
              value={rotationStr}
              inputProps={{ step: 5 }}
              onChange={(e) => { setRotationStr(e.target.value); if (e.target.value !== '') handleConfigChange('rotation', Number(e.target.value)) }}
            />
          </div>
        </div>

        <Divider sx={{ mb: 2 }} />

        {/* Pricing */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-600 mb-2 block">Pricing</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Category</label>
              <TextField
                fullWidth size="small"
                value={config.category || ''}
                placeholder="PRICE1"
                onChange={(e) => handleConfigChange('category', e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Price (€)</label>
              <TextField
                fullWidth size="small" type="number"
                value={config.price ?? ''}
                placeholder="9"
                onChange={(e) => handleConfigChange('price', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </div>
          </div>
          <PriceBreakdown price={String(config.price || '')} site={site} />
        </div>

        {mode === 'create' && (
          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-0.5 block">Group number</label>
            <TextField
              fullWidth size="small" type="number"
              value={groupStr}
              onChange={(e) => { setGroupStr(e.target.value); if (e.target.value !== '') handleConfigChange('group', Number(e.target.value)) }}
            />
          </div>
        )}

        {/* Apply button */}
        {mode === 'edit' && (
          <Button
            fullWidth
            variant="contained"
            size="small"
            onClick={handleApplyChanges}
            sx={{ textTransform: 'none', mb: 1 }}
          >
            Apply changes
          </Button>
        )}

        {/* Reverse seat numbering */}
        {mode === 'edit' && editGroup && (
          <Button
            fullWidth
            variant="outlined"
            size="small"
            onClick={async () => {
              await reverseParcelNumbering(siteId, editGroup)
              const updatedSite = await getSite(siteId)
              setSite(updatedSite!)
            }}
            sx={{ textTransform: 'none', mb: 2 }}
          >
            Reverse seat numbering
          </Button>
        )}


        {/* Edit mode actions */}
        {mode === 'edit' && editGroup && (
          <>
            <Divider sx={{ mb: 2 }} />

            {/* Visibility toggle */}
            {config.itemGroupId && (
              <div className={`flex items-center justify-between rounded-lg border p-3 mb-4 ${
                allDisabled ? 'border-gray-200 bg-gray-50' : 'border-green-200 bg-green-50'
              }`}>
                <div>
                  <div className={`text-sm font-medium ${allDisabled ? 'text-gray-600' : 'text-green-700'}`}>
                    {allDisabled ? 'Hidden' : 'Visible'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {allDisabled ? 'Not shown to customers' : 'Visible to customers'}
                  </div>
                </div>
                <Switch
                  size="small"
                  checked={!allDisabled}
                  color="success"
                  onChange={async () => {
                    const newStatus = allDisabled ? 'active' : 'disabled'
                    await setItemStatusByGroup(config.itemGroupId!, newStatus)
                    const updatedSite = await getSite(siteId)
                    setSite(updatedSite!)
                  }}
                />
              </div>
            )}

            {/* Danger zone */}
            <div className="rounded-lg border border-red-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-red-600">Delete parcel</div>
                  <div className="text-xs text-gray-500">Remove all {parcelItems.length} sunbeds</div>
                </div>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteOutlineIcon fontSize="small" />}
                  onClick={async () => {
                    await deleteItemsByGroup(siteId, editGroup)
                    const updatedSite = await getSite(siteId)
                    setSite(updatedSite!)
                    onDeleteParcel(editGroup)
                  }}
                  sx={{ textTransform: 'none', fontSize: '0.7rem' }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
