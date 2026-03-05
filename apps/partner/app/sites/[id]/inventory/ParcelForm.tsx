// ParcelFormView.tsx
'use client'

import React, { useEffect, useRef } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useSite } from '@/app/sites/site-context'
import { ChairConfig } from './chair-util'
import { syncChairsWithLayout, setItemStatusByGroup } from './actions'
import { deleteItemsByGroup } from '../inventory-actions'
import { getSite } from '../queries'

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

  const parcelItems = site.inventoryItems?.filter(item => item.group === config.group) || []
  const activeItems = parcelItems?.filter(item => item.status !== 'disabled') || []
  const allDisabled = parcelItems.length > 0 && activeItems.length === 0

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    if (mode === 'edit' && editGroup) {
      setConfig((prev) => ({ ...prev, group: editGroup }))
    }
  }, [mode, editGroup, setConfig])

  const handleConfigChange = (field: keyof ChairConfig, value: number | boolean | string) => {
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
              ? 'Configure layout, then click map to place'
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
                value={config.rows}
                disabled={mode === 'edit'}
                onChange={(e) => handleConfigChange('rows', Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Seats/row</label>
              <TextField
                fullWidth size="small" type="number"
                value={config.seatsPerRow}
                disabled={mode === 'edit'}
                onChange={(e) => handleConfigChange('seatsPerRow', Number(e.target.value))}
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
          {config.pairSeats && (
            <div className="w-1/2 pr-1 mb-2">
              <label className="text-xs text-gray-500 mb-0.5 block">Between paired beds</label>
              <TextField
                fullWidth size="small" type="number"
                value={config.intraPairGap}
                inputProps={{ step: 0.1 }}
                onChange={(e) => handleConfigChange('intraPairGap', Number(e.target.value))}
              />
            </div>
          )}
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">{config.pairSeats ? 'Between pairs' : 'Horizontal'}</label>
              <TextField
                fullWidth size="small" type="number"
                value={config.horizontalGap}
                inputProps={{ step: 0.1 }}
                onChange={(e) => handleConfigChange('horizontalGap', Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Between rows</label>
              <TextField
                fullWidth size="small" type="number"
                value={config.verticalGap}
                inputProps={{ step: 0.5 }}
                onChange={(e) => handleConfigChange('verticalGap', Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Rotation */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-0.5 block">Rotation (°)</label>
          <TextField
            fullWidth size="small" type="number"
            value={config.rotation}
            inputProps={{ step: 5 }}
            onChange={(e) => handleConfigChange('rotation', Number(e.target.value))}
          />
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
                value={config.price || ''}
                placeholder="9"
                onChange={(e) => handleConfigChange('price', Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {mode === 'create' && (
          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-0.5 block">Group number</label>
            <TextField
              fullWidth size="small" type="number"
              value={config.group}
              onChange={(e) => handleConfigChange('group', Number(e.target.value))}
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
            sx={{ textTransform: 'none', mb: 2 }}
          >
            Apply changes
          </Button>
        )}

        {/* Create instruction */}
        {mode === 'create' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-center">
            <p className="text-sm text-green-700 font-medium">Click on the map to place</p>
            <p className="text-xs text-green-600 mt-0.5">
              {config.rows} rows × {config.seatsPerRow} seats = {config.rows * config.seatsPerRow} sunbeds
            </p>
          </div>
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
