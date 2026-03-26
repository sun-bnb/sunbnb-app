'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import SurfingIcon from '@mui/icons-material/Surfing'

import PaymentsIcon from '@mui/icons-material/Payments'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'

import { useSite } from '@/app/sites/site-context'
import {
  getRentalItems,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  saveRentalVat,
  toggleSiteFeature,
  setRentalPaymentType,
} from './actions'

interface RentalItemData {
  id: string
  name: string
  description: string | null
  category: string | null
  pricePerHour: number | null
  pricePerDay: number | null
  totalQuantity: number
  active: boolean
  _count?: { bookings: number }
}

const CATEGORIES = [
  { value: 'surfboard', label: '🏄 Surfboard' },
  { value: 'paddleboard', label: '🏄‍♂️ Paddleboard' },
  { value: 'kayak', label: '🛶 Kayak' },
  { value: 'pedalboat', label: '🚤 Pedal boat' },
  { value: 'snorkel', label: '🤿 Snorkel set' },
  { value: 'other', label: '📦 Other' },
]

function ItemForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: RentalItemData | null
  onSave: (data: any) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [category, setCategory] = useState(initial?.category || 'other')
  const [pricePerHour, setPricePerHour] = useState(initial?.pricePerHour?.toString() || '')
  const [pricePerDay, setPricePerDay] = useState(initial?.pricePerDay?.toString() || '')
  const [totalQuantity, setTotalQuantity] = useState(initial?.totalQuantity?.toString() || '1')

  return (
    <div className="space-y-4">
      <TextField
        fullWidth
        label="Item name"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Stand-up paddleboard"
        size="small"
      />
      <TextField
        fullWidth
        label="Description (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="e.g. Inflatable SUP with paddle and leash"
        size="small"
        multiline
        rows={2}
      />
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">Category</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                category === cat.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <TextField
          fullWidth
          label="Price per hour (€)"
          type="number"
          value={pricePerHour}
          onChange={e => setPricePerHour(e.target.value)}
          placeholder="e.g. 10"
          size="small"
        />
        <TextField
          fullWidth
          label="Price per day (€)"
          type="number"
          value={pricePerDay}
          onChange={e => setPricePerDay(e.target.value)}
          placeholder="e.g. 30"
          size="small"
        />
      </div>
      <TextField
        fullWidth
        label="Available quantity"
        type="number"
        value={totalQuantity}
        onChange={e => setTotalQuantity(e.target.value)}
        placeholder="e.g. 5"
        size="small"
        helperText="How many units of this item you have"
      />
      <div className="flex gap-2 pt-2">
        <Button
          variant="contained"
          disabled={saving || !name.trim()}
          onClick={() =>
            onSave({
              name,
              description,
              category,
              pricePerHour: pricePerHour ? Number(pricePerHour) : undefined,
              pricePerDay: pricePerDay ? Number(pricePerDay) : undefined,
              totalQuantity: Math.max(1, Number(totalQuantity) || 1),
            })
          }
          sx={{ textTransform: 'none' }}
        >
          {saving ? <CircularProgress size={18} color="inherit" /> : initial ? 'Save changes' : 'Add item'}
        </Button>
        <Button onClick={onCancel} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export default function RentalsView() {
  const { site, setSite } = useSite()
  const siteId = site.id!

  const [items, setItems] = useState<RentalItemData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<RentalItemData | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RentalItemData | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [rentalVat, setRentalVat] = useState(site.rentalVat?.toString() || '')

  const rentalsEnabled = (site.features || []).includes('rentals')
  const [togglingRentals, setTogglingRentals] = useState(false)
  const [rentalBillingType, setRentalBillingType] = useState(site.rentalPaymentType ?? site.type ?? 'paid')

  // Debounced VAT save
  useEffect(() => {
    const timer = setTimeout(() => {
      if (rentalVat !== (site.rentalVat?.toString() || '')) {
        saveRentalVat(siteId, rentalVat)
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [rentalVat, siteId, site.rentalVat])

  const fetchItems = useCallback(async () => {
    const result = await getRentalItems(siteId)
    if (result.status === 'ok' && result.items) {
      setItems(result.items as RentalItemData[])
    }
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const handleCreate = async (data: any) => {
    setSaving(true)
    const result = await createRentalItem({ siteId, ...data })
    setSaving(false)
    if (result.status === 'ok') {
      setShowForm(false)
      fetchItems()
    }
  }

  const handleUpdate = async (data: any) => {
    if (!editingItem) return
    setSaving(true)
    const result = await updateRentalItem({
      id: editingItem.id,
      siteId,
      active: editingItem.active,
      ...data,
    })
    setSaving(false)
    if (result.status === 'ok') {
      setEditingItem(null)
      fetchItems()
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await deleteRentalItem(siteId, deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    fetchItems()
  }

  const handleToggleActive = async (item: RentalItemData) => {
    await updateRentalItem({
      id: item.id,
      siteId,
      name: item.name,
      description: item.description || undefined,
      category: item.category || undefined,
      pricePerHour: item.pricePerHour || undefined,
      pricePerDay: item.pricePerDay || undefined,
      totalQuantity: item.totalQuantity,
      active: !item.active,
    })
    fetchItems()
  }

  const getCategoryEmoji = (cat: string | null) => {
    return CATEGORIES.find(c => c.value === cat)?.label.split(' ')[0] || '📦'
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <CircularProgress />
      </div>
    )
  }

  const handleToggleRentals = async (enabled: boolean) => {
    setTogglingRentals(true)
    const result = await toggleSiteFeature(siteId, 'rentals', enabled)
    if (result.status === 'ok' && result.features) {
      setSite({ ...site, features: result.features })
    }
    setTogglingRentals(false)
  }

  return (
    <div className="pt-2">
      {/* Rentals toggle + VAT on same row */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 mt-4 mb-4 gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">Equipment rental</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Allow guests to rent surfboards, kayaks, umbrellas and other equipment through the app.
          </p>
        </div>
        <TextField
          label="VAT %"
          placeholder="eg. 21"
          type="number"
          value={rentalVat}
          onChange={e => setRentalVat(e.target.value)}
          disabled={!rentalsEnabled}
          size="small"
          sx={{ width: 100, flexShrink: 0 }}
          InputProps={{
            endAdornment: <InputAdornment position="end">%</InputAdornment>,
          }}
        />
        <Switch
          checked={rentalsEnabled}
          onChange={(e) => handleToggleRentals(e.target.checked)}
          disabled={togglingRentals}
          size="small"
          sx={{
            flexShrink: 0,
            '& .MuiSwitch-switchBase.Mui-checked': { color: '#111827' },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#111827' },
          }}
        />
      </div>

      {/* Rental billing type — only visible when rentals enabled */}
      {rentalsEnabled && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Rental billing</h3>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setRentalBillingType('paid')
                setRentalPaymentType(site.id!, 'paid')
                setSite({ ...site, rentalPaymentType: 'paid' })
              }}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                rentalBillingType === 'paid'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <PaymentsIcon fontSize="small" className={rentalBillingType === 'paid' ? 'text-blue-600' : 'text-gray-400'} />
                <span className={`font-medium text-sm ${rentalBillingType === 'paid' ? 'text-blue-700' : 'text-gray-700'}`}>
                  Integrated payments
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Customers pay for equipment rentals through the platform.
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setRentalBillingType('unpaid')
                setRentalPaymentType(site.id!, 'unpaid')
                setSite({ ...site, rentalPaymentType: 'unpaid' })
              }}
              className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                rentalBillingType === 'unpaid'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <EventAvailableIcon fontSize="small" className={rentalBillingType === 'unpaid' ? 'text-blue-600' : 'text-gray-400'} />
                <span className={`font-medium text-sm ${rentalBillingType === 'unpaid' ? 'text-blue-700' : 'text-gray-700'}`}>
                  Off-platform billing
                </span>
              </div>
              <p className="text-xs text-gray-500">
                No payment collected for rentals. Billing is handled at the venue, e.g. pay at counter or charge to room.
              </p>
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Rental equipment</h2>
          <p className="text-sm text-gray-500">
            {items.length} item{items.length !== 1 ? 's' : ''} · {items.filter(i => i.active).length} active
          </p>
        </div>
        {!showForm && !editingItem && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowForm(true)}
            sx={{ textTransform: 'none' }}
          >
            Add item
          </Button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/30 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">New rental item</h3>
          <ItemForm onSave={handleCreate} onCancel={() => setShowForm(false)} saving={saving} />
        </div>
      )}

      {/* Item list */}
      {items.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <SurfingIcon sx={{ fontSize: 56, mb: 1 }} />
          <p className="text-sm font-medium">No rental items yet</p>
          <p className="text-xs mt-1">Add surfboards, kayaks, umbrellas, and more</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div
              key={item.id}
              className={`rounded-lg border p-4 transition-all ${
                item.active
                  ? 'border-gray-200 bg-white'
                  : 'border-gray-100 bg-gray-50 opacity-60'
              }`}
            >
              {editingItem?.id === item.id ? (
                <ItemForm
                  initial={item}
                  onSave={handleUpdate}
                  onCancel={() => setEditingItem(null)}
                  saving={saving}
                />
              ) : (
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-0.5">{getCategoryEmoji(item.category)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{item.name}</span>
                      {!item.active && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">Inactive</span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                      {item.pricePerHour && (
                        <span>€{item.pricePerHour}/hr</span>
                      )}
                      {item.pricePerDay && (
                        <span>€{item.pricePerDay}/day</span>
                      )}
                      <span>×{item.totalQuantity} available</span>
                      {item._count?.bookings ? (
                        <span>{item._count.bookings} booking{item._count.bookings !== 1 ? 's' : ''}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch
                      size="small"
                      checked={item.active}
                      onChange={() => handleToggleActive(item)}
                      color="success"
                    />
                    <IconButton size="small" onClick={() => setEditingItem(item)}>
                      <EditIcon fontSize="small" className="text-gray-400" />
                    </IconButton>
                    <IconButton size="small" onClick={() => setDeleteTarget(item)}>
                      <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                    </IconButton>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete rental item?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            {(deleteTarget?._count?.bookings ?? 0) > 0 && (
              <> This item has {deleteTarget?._count?.bookings} booking(s) which will also be removed.</>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={handleDelete}
            sx={{ textTransform: 'none' }}
          >
            {deleting ? <CircularProgress size={16} color="inherit" /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
