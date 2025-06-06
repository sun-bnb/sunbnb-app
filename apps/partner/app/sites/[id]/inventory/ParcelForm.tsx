'use client'

import React, { useEffect, useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { useSite } from '@/app/sites/site-context'
import { generateChairs } from './chair-util'
import { syncChairsWithLayout } from './actions'
import { getSite } from '../actions'

interface ParcelFormProps {
  siteId: string
  editGroup?: number | null
  mode: 'create' | 'edit'
  initialLat: number
  initialLng: number
  onCancel: () => void
  onPlace: (items: ReturnType<typeof generateChairs>) => void
  onDeleteParcel: (group: number) => void
}

export default function ParcelFormView({
  siteId,
  mode,
  editGroup,
  initialLat,
  initialLng,
  onCancel,
  onPlace,
  onDeleteParcel,
}: ParcelFormProps) {
  const [config, setConfig] = useState({
    rows: 2,
    seatsPerRow: 4,
    horizontalGap: 0.4,
    verticalGap: 4.5,
    rotation: 0,
    group: editGroup ?? 1,
    pairSeats: true,
    intraPairGap: 1.6,
    baseLat: initialLat,
    baseLng: initialLng,
  })

  const [previewItems, setPreviewItems] = useState(generateChairs(config))
  const { setSite } = useSite()

  // Regenerate chairs whenever config changes
  useEffect(() => {
    setPreviewItems(generateChairs(config))
  }, [config])

  // If group number changes in edit mode, keep config in sync
  useEffect(() => {
    if (mode === 'edit' && editGroup) {
      setConfig((prev) => ({ ...prev, group: editGroup }))
    }
  }, [mode, editGroup])

  // If parcel is moved (via map click), update lat/lng
  useEffect(() => {
    setConfig((prev) => {
      const newConfig = { ...prev, baseLat: initialLat, baseLng: initialLng }
  
      // Only trigger auto-sync if we're editing
      if (mode === 'edit') {
        syncChairsWithLayout(siteId, newConfig).then(async () => {
          const updatedSite = await getSite(siteId)
          setSite(updatedSite!)
        })
      }
  
      return newConfig
    })
  }, [initialLat, initialLng])
  

  const handleConfigChange = (field: keyof typeof config, value: number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handleApplyChanges = async () => {
    await syncChairsWithLayout(siteId, config)
    const updatedSite = await getSite(siteId)
    setSite(updatedSite!)
  }

  const rotateAndSync = async (delta: number) => {
    const newRotation = config.rotation + delta
    const newConfig = { ...config, rotation: newRotation }
    setConfig(newConfig)
  
    if (mode === 'edit') {
      await syncChairsWithLayout(siteId, newConfig)
      const updatedSite = await getSite(siteId)
      setSite(updatedSite!)
    }
  }
  

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex gap-2">
        <TextField label="Rows" type="number" value={config.rows} disabled={mode === 'edit'} onChange={(e) => handleConfigChange('rows', Number(e.target.value))} />
        <TextField label="Seats per Row" type="number" value={config.seatsPerRow} disabled={mode === 'edit'} onChange={(e) => handleConfigChange('seatsPerRow', Number(e.target.value))} />
        <TextField label="Group (Parcel #)" type="number" value={config.group} disabled={mode === 'edit'} onChange={(e) => handleConfigChange('group', Number(e.target.value))} />
      </div>

      <div className="flex gap-2">
        <TextField label="Horizontal Gap (m)" type="number" value={config.horizontalGap} onChange={(e) => handleConfigChange('horizontalGap', Number(e.target.value))} />
        <TextField label="Vertical Gap (m)" type="number" value={config.verticalGap} onChange={(e) => handleConfigChange('verticalGap', Number(e.target.value))} />
        <TextField label="Rotation (deg)" type="number" value={config.rotation} onChange={(e) => handleConfigChange('rotation', Number(e.target.value))} />
      </div>

      <div className="flex gap-2">
        <TextField label="Intra-Pair Gap (m)" type="number" value={config.intraPairGap} disabled={!config.pairSeats} onChange={(e) => handleConfigChange('intraPairGap', Number(e.target.value))} />
        <Button variant={config.pairSeats ? 'contained' : 'outlined'} onClick={() => handleConfigChange('pairSeats', !config.pairSeats)}>
          {config.pairSeats ? 'Unpair Seats' : 'Pair Seats'}
        </Button>
      </div>

      {mode === 'create' ? (
        <div className="flex gap-2 mt-2">
          <Button variant="contained" onClick={() => onPlace(previewItems)}>Place Parcel</Button>
          <Button variant="outlined" color="error" onClick={onCancel}>Cancel</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-2">
          <Button variant="outlined" onClick={() => rotateAndSync(5)}>Rotate +5°</Button>
          <Button variant="outlined" onClick={() => rotateAndSync(-5)}>Rotate -5°</Button>
          <Button variant="contained" onClick={handleApplyChanges}>Apply Changes</Button>
          <Button variant="outlined" color="error" onClick={() => {
            if (editGroup) onDeleteParcel(editGroup)
          }}>Delete Parcel</Button>
        </div>
      )}
    </div>
  )
}
