'use client'

import React, { useState, useRef } from 'react'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Collapse from '@mui/material/Collapse'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CameraAltIcon from '@mui/icons-material/CameraAlt'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import ImageIcon from '@mui/icons-material/Image'
import { Product } from '@/types/shared'
import { updateProduct, updateProductImage, deleteProduct } from './actions'

interface ProductItemProps {
  product: Product
  onUpdated: () => void
}

export default function ProductItem({ product, onUpdated }: ProductItemProps) {

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(product.description || '')
  const [totalPrice, setTotalPrice] = useState(product.totalPrice)
  const [tax, setTax] = useState(product.tax)

  const fileRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    setSaving(true)
    await updateProduct(product.id, {
      name,
      description: description || null,
      totalPrice,
      tax,
    })
    setSaving(false)
    setEditing(false)
    onUpdated()
  }

  const handleCancel = () => {
    setName(product.name)
    setDescription(product.description || '')
    setTotalPrice(product.totalPrice)
    setTax(product.tax)
    setEditing(false)
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('image', file)
    await updateProductImage(product.id, fd)
    onUpdated()
  }

  const handleDelete = async () => {
    await deleteProduct(product.id)
    setConfirmDelete(false)
    onUpdated()
  }

  const priceBeforeTax = totalPrice / (1 + tax / 100)

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        {/* Image */}
        <div
          className="relative w-16 h-16 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer group"
          onClick={() => fileRef.current?.click()}
        >
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon className="text-gray-300" fontSize="large" />
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <CameraAltIcon className="text-white" fontSize="small" />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleImageChange}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{product.name}</h3>
          </div>
          {product.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{product.description}</p>
          )}
          <div className="flex items-baseline gap-3 mt-1.5">
            <span className="text-sm font-semibold text-gray-900">
              €{product.totalPrice.toFixed(2)}
            </span>
            <span className="text-xs text-gray-400">
              €{product.price.toFixed(2)} + {product.tax}% tax
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => setEditing(!editing)}>
              <EditIcon fontSize="small" className="text-gray-400" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => setConfirmDelete(true)}>
              <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* Inline edit form */}
      <Collapse in={editing}>
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-3 mt-3">
            <TextField
              label="Name"
              size="small"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Description"
              size="small"
              fullWidth
              multiline
              minRows={1}
              maxRows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Total price (€)"
              size="small"
              type="number"
              value={totalPrice}
              onChange={(e) => setTotalPrice(parseFloat(e.target.value) || 0)}
              inputProps={{ step: '0.01' }}
            />
            <TextField
              label="Tax %"
              size="small"
              type="number"
              value={tax}
              onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
              inputProps={{ step: '0.01' }}
            />
          </div>
          <div className="text-xs text-gray-400 mt-2">
            Price before tax: €{priceBeforeTax.toFixed(2)}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button
              size="small"
              variant="text"
              startIcon={<CloseIcon fontSize="small" />}
              onClick={handleCancel}
              sx={{ textTransform: 'none', color: '#6b7280' }}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckIcon fontSize="small" />}
              disabled={saving || !name}
              onClick={handleSave}
              sx={{ textTransform: 'none', backgroundColor: '#111827', '&:hover': { backgroundColor: '#374151' } }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Collapse>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete product?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to remove <strong>{product.name}</strong>? This will hide it from your product list.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleDelete} color="error" sx={{ textTransform: 'none' }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
