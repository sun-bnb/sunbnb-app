'use client'

import { useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import type { MenuItemFormValues, MenuItemSaveResult } from './menu-types'

export interface MenuItemDialogLabels {
  titleCreate: string
  titleEdit: string
  fieldName: string
  fieldDescription: string
  fieldPrice: string
  fieldVat: string
  /** Hint row under the price inputs, e.g. "Net price". */
  netPriceLabel: string
  fieldCategory: string
  fieldCategoryHelper: string
  imageCurrent: string
  imagePick: string
  imageRemove: string
  cancel: string
  save: string
  saving: string
  errorPrefix: string
}

export interface MenuItemDialogProps {
  open: boolean
  onClose: () => void
  labels: MenuItemDialogLabels
  initial: {
    name: string
    description: string
    totalPrice: number
    tax: number
    category: string
    imageUrl: string | null
  } | null
  onSubmit: (values: MenuItemFormValues) => Promise<MenuItemSaveResult>
}

/** Create / edit modal. Controlled by the parent via `open` + `initial`. */
export function MenuItemDialog({
  open,
  onClose,
  labels,
  initial,
  onSubmit,
}: MenuItemDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [totalPrice, setTotalPrice] = useState(0)
  const [tax, setTax] = useState(0)
  const [category, setCategory] = useState('main')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setTotalPrice(initial?.totalPrice ?? 0)
    setTax(initial?.tax ?? 0)
    setCategory(initial?.category ?? 'main')
    setImageUrl(initial?.imageUrl ?? null)
    setImageFile(null)
    setErrors([])
  }, [open, initial])

  const handleSubmit = async () => {
    setBusy(true)
    setErrors([])
    const res = await onSubmit({
      name: name.trim(),
      description: description.trim(),
      totalPrice,
      tax,
      category: category.trim() || 'main',
      imageUrl,
      imageFile,
    })
    setBusy(false)
    if (res.status === 'error') setErrors(res.errors ?? [])
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>
        {initial ? labels.titleEdit : labels.titleCreate}
      </DialogTitle>
      <DialogContent>
        <div className="flex flex-col gap-3 pt-1">
          <TextField
            size="small"
            label={labels.fieldName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />
          <TextField
            size="small"
            label={labels.fieldDescription}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          {/* Price ¼ + VAT ¼ + category ½ */}
          <div className="flex gap-3">
            <TextField
              size="small"
              label={labels.fieldPrice}
              type="number"
              value={totalPrice}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                setTotalPrice(n)
              }}
              inputProps={{ min: 0, step: 0.1 }}
              className="basis-1/4 min-w-0"
            />
            <TextField
              size="small"
              label={labels.fieldVat}
              type="number"
              value={tax}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                setTax(n)
              }}
              inputProps={{ min: 0, max: 100, step: 1 }}
              className="basis-1/4 min-w-0"
            />
            <TextField
              size="small"
              label={labels.fieldCategory}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              helperText={labels.fieldCategoryHelper}
              className="basis-1/2 min-w-0"
            />
          </div>
          {tax > 0 && totalPrice > 0 && (
            <div className="text-xs text-gray-500 -mt-1">
              {labels.netPriceLabel}: {(totalPrice / (1 + tax / 100)).toFixed(2)}
            </div>
          )}

          <div className="flex items-center gap-3">
            {imageUrl && !imageFile ? (
              <img
                src={imageUrl}
                alt=""
                className="h-16 w-16 rounded object-cover border border-gray-200"
              />
            ) : imageFile ? (
              <img
                src={URL.createObjectURL(imageFile)}
                alt=""
                className="h-16 w-16 rounded object-cover border border-gray-200"
              />
            ) : (
              <div className="h-16 w-16 rounded bg-gray-100 border border-gray-200" />
            )}
            <div className="flex flex-col gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setImageFile(f)
                }}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => fileRef.current?.click()}
                sx={{ textTransform: 'none' }}
              >
                {imageUrl || imageFile ? labels.imageCurrent : labels.imagePick}
              </Button>
              {(imageUrl || imageFile) && (
                <Button
                  size="small"
                  color="error"
                  onClick={() => {
                    setImageUrl(null)
                    setImageFile(null)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                  sx={{ textTransform: 'none' }}
                >
                  {labels.imageRemove}
                </Button>
              )}
            </div>
          </div>

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
          variant="contained"
          disabled={busy || name.trim().length === 0}
          onClick={handleSubmit}
          sx={{ textTransform: 'none' }}
        >
          {busy ? labels.saving : labels.save}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
