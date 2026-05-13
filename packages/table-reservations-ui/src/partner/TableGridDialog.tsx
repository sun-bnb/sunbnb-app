'use client'

import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import type { TableShape } from '@repo/schematic/grid'

export interface TableGridDialogLabels {
  title: string
  rows: string
  cols: string
  capacity: string
  shape: string
  shapeSquare: string
  shapeRound: string
  shapeRect: string
  horizontalGap: string
  verticalGap: string
  tableWidth: string
  tableHeight: string
  rotation: string
  cancel: string
  create: string
  creating: string
  errorPrefix: string
}

export interface TableGridSubmit {
  rows: number
  cols: number
  originX: number
  originY: number
  horizontalGap: number
  verticalGap: number
  tableWidth: number
  tableHeight: number
  capacity: number
  shape: TableShape
  rotation: number
}

export interface TableGridDialogProps {
  open: boolean
  onClose: () => void
  labels: TableGridDialogLabels
  worldWidth: number
  worldHeight: number
  onSubmit: (input: TableGridSubmit) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

/** Modal dialog to place a rows × cols grid of tables at the canvas centre. */
export function TableGridDialog({
  open,
  onClose,
  labels,
  worldWidth,
  worldHeight,
  onSubmit,
}: TableGridDialogProps) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(4)
  const [capacity, setCapacity] = useState(4)
  const [shape, setShape] = useState<TableShape>('square')
  const [horizontalGap, setHorizontalGap] = useState(0.8)
  const [verticalGap, setVerticalGap] = useState(0.8)
  const [tableWidth, setTableWidth] = useState(1.2)
  const [tableHeight, setTableHeight] = useState(1.2)
  const [rotation, setRotation] = useState(0)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const handleSubmit = async () => {
    setBusy(true)
    setErrors([])
    // Centre the grid in the canvas: place the top-left table so the whole
    // grid ends up visually centred.
    const gridWidth = cols * tableWidth + (cols - 1) * horizontalGap
    const gridHeight = rows * tableHeight + (rows - 1) * verticalGap
    const originX = (worldWidth - gridWidth) / 2 + tableWidth / 2
    const originY = (worldHeight - gridHeight) / 2 + tableHeight / 2

    const res = await onSubmit({
      rows,
      cols,
      originX,
      originY,
      horizontalGap,
      verticalGap,
      tableWidth,
      tableHeight,
      capacity,
      shape,
      rotation,
    })
    setBusy(false)
    if (res.status === 'error') setErrors(res.errors ?? [])
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{labels.title}</DialogTitle>
      <DialogContent>
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex gap-3">
            <TextField
              size="small"
              label={labels.rows}
              type="number"
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              inputProps={{ min: 1, max: 50 }}
              fullWidth
            />
            <TextField
              size="small"
              label={labels.cols}
              type="number"
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              inputProps={{ min: 1, max: 50 }}
              fullWidth
            />
          </div>
          <div className="flex gap-3">
            <TextField
              size="small"
              label={labels.capacity}
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              inputProps={{ min: 1, max: 50 }}
              fullWidth
            />
            <TextField
              select
              size="small"
              label={labels.shape}
              value={shape}
              onChange={(e) => setShape(e.target.value as TableShape)}
              fullWidth
            >
              <MenuItem value="square">{labels.shapeSquare}</MenuItem>
              <MenuItem value="round">{labels.shapeRound}</MenuItem>
              <MenuItem value="rect">{labels.shapeRect}</MenuItem>
            </TextField>
          </div>
          <div className="flex gap-3">
            <TextField
              size="small"
              label={labels.tableWidth}
              type="number"
              value={tableWidth}
              onChange={(e) => setTableWidth(Number(e.target.value) || 0.5)}
              inputProps={{ step: 0.1, min: 0.5, max: 5 }}
              fullWidth
            />
            <TextField
              size="small"
              label={labels.tableHeight}
              type="number"
              value={tableHeight}
              onChange={(e) => setTableHeight(Number(e.target.value) || 0.5)}
              inputProps={{ step: 0.1, min: 0.5, max: 5 }}
              fullWidth
            />
          </div>
          <div className="flex gap-3">
            <TextField
              size="small"
              label={labels.horizontalGap}
              type="number"
              value={horizontalGap}
              onChange={(e) => setHorizontalGap(Number(e.target.value) || 0)}
              inputProps={{ step: 0.1, min: 0, max: 5 }}
              fullWidth
            />
            <TextField
              size="small"
              label={labels.verticalGap}
              type="number"
              value={verticalGap}
              onChange={(e) => setVerticalGap(Number(e.target.value) || 0)}
              inputProps={{ step: 0.1, min: 0, max: 5 }}
              fullWidth
            />
          </div>
          <TextField
            size="small"
            label={labels.rotation}
            type="number"
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value) || 0)}
            inputProps={{ min: -180, max: 180, step: 5 }}
          />
          {errors.length > 0 && (
            <div className="text-xs text-red-600">
              {labels.errorPrefix}: {errors.join(', ')}
            </div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          {labels.cancel}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={busy}
          sx={{ textTransform: 'none' }}
        >
          {busy ? labels.creating : labels.create}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
