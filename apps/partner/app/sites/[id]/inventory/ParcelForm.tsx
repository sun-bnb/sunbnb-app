'use client'

import React, { useState, useEffect } from 'react'
import { selectItemsByGroup, deleteItemsByGroup, moveItemsByGroup, getSite } from '../actions'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { useSite } from '@/app/sites/site-context'

interface ParcelFormProps {
  siteId: string
  editGroup?: number | null
  mode: 'create' | 'edit'
  initialLat: number
  initialLng: number
  onCancel: () => void
  onPlace: (items: {
    locationLat: string
    locationLng: string
    rotation: number
    group: number
    pairId?: string
    number: number
    tempId: string
    pairTempId: string
  }[]) => void
  onDeleteParcel: (group: number) => void
  onMoveParcel?: (dir: 'up' | 'down' | 'left' | 'right') => void
  onRotateParcel?: (delta: number) => void
  onUpdateGaps?: (params: { horizontalGap: number; verticalGap: number; intraPairGap: number }) => void
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
  onMoveParcel,
  onRotateParcel,
  onUpdateGaps,
}: ParcelFormProps) {

  const [rows, setRows] = useState(2)
  const [seatsPerRow, setSeatsPerRow] = useState(4)
  const [horizontalGap, setHorizontalGap] = useState(0.4)
  const [verticalGap, setVerticalGap] = useState(4.5)
  const [rotation, setRotation] = useState(0)
  const [group, setGroup] = useState(1)
  const [baseLat, setBaseLat] = useState(initialLat)
  const [baseLng, setBaseLng] = useState(initialLng)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [pairSeats, setPairSeats] = useState(true)
  const [intraPairGap, setIntraPairGap] = useState(1.6)

  const { setSite } = useSite()

  useEffect(() => {
    if (mode === 'edit' && editGroup) {
      selectItemsByGroup(siteId, group).then((items) => {
        if (!items || items.length === 0) return

        const avgLat = items.reduce((sum, i) => sum + parseFloat(i.locationLat), 0) / items.length
        const avgLng = items.reduce((sum, i) => sum + parseFloat(i.locationLng), 0) / items.length

        setRotation(items[0]!.rotation ?? 0)
        setBaseLat(avgLat)
        setBaseLng(avgLng)
      })
    }
  }, [mode, group])
  
  useEffect(() => {
    if (mode === 'create') {
      const newItems = generateChairs()
      setPreviewItems(newItems)
    }
  }, [rows, seatsPerRow, horizontalGap, verticalGap, rotation, group, pairSeats, intraPairGap, mode])

  const generateChairs = () => {
    const items: any[] = []
    const degToRad = (deg: number) => deg * (Math.PI / 180)
    const rad = degToRad(rotation)
    const metersPerLat = 111320
    const metersPerLng = 111320 * Math.cos(baseLat * Math.PI / 180)
  
    for (let r = 0; r < rows; r++) {
      let c = 0
      while (c < seatsPerRow) {
        const isPair = pairSeats && c + 1 < seatsPerRow
        const tempIdA = `${group}-R${r + 1}C${c + 1}`
        const tempIdB = `${group}-R${r + 1}C${c + 2}`
  
        const dx1 = c * (pairSeats ? intraPairGap + horizontalGap : horizontalGap)
        const dy1 = r * verticalGap
  
        const offsetLat1 = (dy1 * Math.cos(rad) - dx1 * Math.sin(rad)) / metersPerLat
        const offsetLng1 = (dy1 * Math.sin(rad) + dx1 * Math.cos(rad)) / metersPerLng
  
        const rowNum1 = (r + 1).toString().padStart(2, '0')
        const seatNum1 = (c + 1).toString().padStart(2, '0')
  
        const seatA = {
          tempId: tempIdA,
          ...(isPair ? { pairTempId: tempIdB } : {}),
          locationLat: (baseLat + offsetLat1).toString(),
          locationLng: (baseLng + offsetLng1).toString(),
          rotation,
          group,
          number: Number(`${group}${rowNum1}${seatNum1}`),
        }
  
        items.push(seatA)
  
        if (isPair) {
          const dx2 = dx1 + intraPairGap
          const offsetLat2 = (dy1 * Math.cos(rad) - dx2 * Math.sin(rad)) / metersPerLat
          const offsetLng2 = (dy1 * Math.sin(rad) + dx2 * Math.cos(rad)) / metersPerLng
  
          const seatNum2 = (c + 2).toString().padStart(2, '0')
  
          const seatB = {
            tempId: tempIdB,
            pairTempId: tempIdA,
            locationLat: (baseLat + offsetLat2).toString(),
            locationLng: (baseLng + offsetLng2).toString(),
            rotation,
            group,
            number: Number(`${group}${rowNum1}${seatNum2}`),
          }
  
          items.push(seatB)
          c += 2
        } else {
          c += 1
        }
      }
    }
  
    return items
  }
  

  const handlePlace = () => {
    if (mode === 'create') onPlace(previewItems)
  }

  const handleUpdateGaps = () => {
    if (onUpdateGaps)
      onUpdateGaps({ horizontalGap, verticalGap, intraPairGap })
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex gap-2">
        <TextField
          label="Rows"
          type="number"
          value={rows}
          disabled={mode === 'edit'}
          onChange={(e) => setRows(Number(e.target.value))}
        />
        <TextField
          label="Seats per Row"
          type="number"
          value={seatsPerRow}
          disabled={mode === 'edit'}
          onChange={(e) => setSeatsPerRow(Number(e.target.value))}
        />
        <TextField
          label="Group (Parcel #)"
          type="number"
          value={group}
          disabled={mode === 'edit'}
          onChange={(e) => setGroup(Number(e.target.value))}
        />
      </div>
      <div className="flex gap-2">
        <TextField
          label="Horizontal Gap (m)"
          type="number"
          value={horizontalGap}
          onChange={(e) => setHorizontalGap(Number(e.target.value))}
        />
        <TextField
          label="Vertical Gap (m)"
          type="number"
          value={verticalGap}
          onChange={(e) => setVerticalGap(Number(e.target.value))}
        />
        <TextField
          label="Rotation (deg)"
          type="number"
          value={rotation}
          onChange={(e) => setRotation(Number(e.target.value))}
        />
      </div>
      <div className="flex gap-2">
        <TextField
          label="Intra-Pair Gap (m)"
          type="number"
          value={intraPairGap}
          onChange={(e) => setIntraPairGap(Number(e.target.value))}
          disabled={!pairSeats}
        />
        <Button
          variant={pairSeats ? 'contained' : 'outlined'}
          onClick={() => setPairSeats(!pairSeats)}
        >
          {pairSeats ? 'Unpair Seats' : 'Pair Seats'}
        </Button>
      </div>

      {mode === 'create' ? (
        <div className="flex gap-2 mt-2">
          <Button variant="contained" onClick={handlePlace}>
            Place Parcel
          </Button>
          <Button variant="outlined" color="error" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-2">
          <Button variant="outlined" onClick={() => {
            moveItemsByGroup(siteId, group, 'up').then((site) => {
              if (site) setSite(site)
            })
          }}>↑ Move Up</Button>
          <Button variant="outlined" onClick={() => {
            moveItemsByGroup(siteId, group, 'down').then((site) => {
              if (site) setSite(site)
            })
          }}>↓ Move Down</Button>
          <Button variant="outlined" onClick={() => {
            moveItemsByGroup(siteId, group, 'left').then((site) => {
              if (site) setSite(site)
            })
          }}>← Move Left</Button>
          <Button variant="outlined" onClick={() => {
            moveItemsByGroup(siteId, group, 'right').then((site) => {
              if (site) setSite(site)
            })
          }}>→ Move Right</Button>
          <Button variant="outlined" onClick={() => onRotateParcel?.(5)}>Rotate +5°</Button>
          <Button variant="outlined" onClick={() => onRotateParcel?.(-5)}>Rotate −5°</Button>
          <Button variant="contained" onClick={handleUpdateGaps}>Update Gaps</Button>
          <Button variant="outlined" color="error" onClick={() => {
            if (editGroup) {
              deleteItemsByGroup(siteId, editGroup).then(() => {
                if (onDeleteParcel) onDeleteParcel(editGroup)
              })
            }
          }}>Delete Parcel</Button>
        </div>
      )}
    </div>
  )
}
