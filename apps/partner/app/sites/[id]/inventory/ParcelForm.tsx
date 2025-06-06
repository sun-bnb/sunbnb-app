// ParcelFormView.tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { useSite } from '@/app/sites/site-context'
import { generateChairs, ChairConfig } from './chair-util'
import { syncChairsWithLayout } from './actions'
import { deleteItemsByGroup, getSite } from '../actions'

interface ParcelFormProps {
  siteId: string
  editGroup?: number | null
  mode: 'create' | 'edit'
  config: ChairConfig
  setConfig: React.Dispatch<React.SetStateAction<ChairConfig>>
  moveTrigger: number
  onCancel: () => void
  onDeleteParcel: (group: number) => void
}

export default function ParcelFormView({
  siteId,
  editGroup,
  mode,
  config,
  setConfig,
  moveTrigger,
  onCancel,
  onDeleteParcel,
}: ParcelFormProps) {
  const [previewItems, setPreviewItems] = useState(generateChairs(config))
  const { setSite } = useSite()

  const configRef = useRef(config)

  useEffect(() => {
    setPreviewItems(generateChairs(config))
    configRef.current = config // Keep latest config for side effects
  }, [config])

  useEffect(() => {
    if (mode === 'edit' && editGroup) {
      setConfig((prev) => ({ ...prev, group: editGroup }))
    }
  }, [mode, editGroup, setConfig])

  useEffect(() => {
    if (mode === 'edit' && moveTrigger) {
      const latestConfig = configRef.current
      console.log('Syncing chairs with layout due to move trigger:', latestConfig)
      syncChairsWithLayout(siteId, latestConfig).then(async () => {
        const updatedSite = await getSite(siteId)
        if (updatedSite) setSite(updatedSite)
      })
    }
  }, [moveTrigger])

  const handleConfigChange = (field: keyof ChairConfig, value: number | boolean) => {
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

      {mode === 'edit' && (
        <div className="flex flex-wrap gap-2 mt-2">
          <Button variant="outlined" onClick={() => rotateAndSync(5)}>Rotate +5°</Button>
          <Button variant="outlined" onClick={() => rotateAndSync(-5)}>Rotate -5°</Button>
          <Button variant="contained" onClick={handleApplyChanges}>Apply Changes</Button>
          <Button variant="outlined" color="error" onClick={() => {
            if (editGroup) {
              deleteItemsByGroup(siteId, editGroup).then(async () => {
                const updatedSite = await getSite(siteId)
                setSite(updatedSite!)
                onDeleteParcel(editGroup)
              })
            }
          }}>Delete Parcel</Button>
        </div>
      )}
    </div>
  )
}
