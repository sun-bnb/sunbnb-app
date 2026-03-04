'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PublicIcon from '@mui/icons-material/Public'

import { savePlatformVatConfig, deletePlatformVatConfig } from './actions'

interface VatConfig {
  id: string
  countryCode: string
  vatNumber: string
  companyName: string
  companyAddress: string
  ossRegistered: boolean
}

type FormData = {
  id?: string
  countryCode: string
  vatNumber: string
  companyName: string
  companyAddress: string
  ossRegistered: boolean
}

const emptyForm: FormData = {
  countryCode: '',
  vatNumber: '',
  companyName: '',
  companyAddress: '',
  ossRegistered: false,
}

export default function PlatformView({
  initialConfigs,
}: {
  initialConfigs: VatConfig[]
}) {
  const [configs] = useState<VatConfig[]>(initialConfigs)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<VatConfig | null>(null)
  const [deleting, setDeleting] = useState(false)

  const openNew = () => {
    setForm(emptyForm)
    setErrors([])
    setEditing(true)
  }

  const openEdit = (config: VatConfig) => {
    setForm({
      id: config.id,
      countryCode: config.countryCode,
      vatNumber: config.vatNumber,
      companyName: config.companyName,
      companyAddress: config.companyAddress,
      ossRegistered: config.ossRegistered,
    })
    setErrors([])
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setErrors([])
    const result = await savePlatformVatConfig(form)
    setSaving(false)
    if (result.status === 'ok') {
      setEditing(false)
      // Optimistic: reload
      window.location.reload()
    } else {
      setErrors(result.errors ?? ['Unknown error'])
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await deletePlatformVatConfig(deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    window.location.reload()
  }

  return (
    <div className="p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-800">Platform Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage platform VAT registrations used for deemed-provider invoicing.
        </p>
      </div>

      {/* Config list */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">VAT Registrations</h3>
          {!editing && (
            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={openNew}
              sx={{ textTransform: 'none', fontSize: '0.8rem' }}
            >
              Add registration
            </Button>
          )}
        </div>

        {configs.length === 0 && !editing && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <PublicIcon sx={{ fontSize: 48, mb: 1, color: '#d1d5db' }} />
            <p className="text-sm">No VAT registrations configured</p>
            <p className="text-xs mt-1">
              Add at least one registration to enable deemed-provider invoicing.
            </p>
          </div>
        )}

        {configs.map((config) => (
          <div
            key={config.id}
            className="border border-gray-200 rounded-lg bg-white p-4 mb-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 text-xs font-bold">
                    {config.countryCode}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-800">
                      {config.companyName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {config.vatNumber}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1 ml-10">
                  {config.companyAddress}
                </div>
                {config.ossRegistered && (
                  <div className="flex items-center gap-1 mt-1 ml-10">
                    <CheckCircleIcon sx={{ fontSize: 12 }} className="text-green-500" />
                    <span className="text-[10px] text-green-600 font-medium">OSS registered</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <IconButton size="small" onClick={() => openEdit(config)}>
                  <EditIcon fontSize="small" className="text-gray-400" />
                </IconButton>
                <IconButton size="small" onClick={() => setDeleteTarget(config)}>
                  <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create form */}
      {editing && (
        <div className="border-2 border-blue-300 rounded-lg bg-blue-50/30 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            {form.id ? 'Edit VAT Registration' : 'New VAT Registration'}
          </h3>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 mb-3">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600">{e}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <TextField
              label="Country code"
              size="small"
              value={form.countryCode}
              onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
              placeholder="e.g. FI"
              inputProps={{ maxLength: 2 }}
              disabled={!!form.id}
              helperText={form.id ? 'Cannot change country' : 'ISO 3166-1 alpha-2'}
            />
            <TextField
              label="VAT number"
              size="small"
              value={form.vatNumber}
              onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
              placeholder="e.g. FI12345678"
            />
          </div>

          <TextField
            label="Company name"
            size="small"
            fullWidth
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            placeholder="e.g. SunBnB Oy"
            sx={{ mb: 1.5 }}
          />

          <TextField
            label="Company address"
            size="small"
            fullWidth
            value={form.companyAddress}
            onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
            placeholder="e.g. Mannerheimintie 1, 00100 Helsinki, Finland"
            sx={{ mb: 1.5 }}
          />

          <div className="flex items-center gap-2 mb-3">
            <Switch
              size="small"
              checked={form.ossRegistered}
              onChange={(e) => setForm({ ...form, ossRegistered: e.target.checked })}
            />
            <div>
              <span className="text-sm text-gray-700">OSS registered</span>
              <p className="text-xs text-gray-400">
                One-Stop Shop for cross-border EU VAT. Used as fallback when no exact country match exists.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="contained"
              size="small"
              onClick={handleSave}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              {saving ? (
                <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving…</>
              ) : (
                form.id ? 'Save changes' : 'Create registration'
              )}
            </Button>
            <Button
              size="small"
              onClick={() => setEditing(false)}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete VAT registration?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove the <strong>{deleteTarget?.countryCode}</strong> registration
            for <strong>{deleteTarget?.companyName}</strong>? Existing deemed-provider
            invoices that reference this VAT number will not be affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleting}
            sx={{ textTransform: 'none' }}
          >
            {deleting ? (
              <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Deleting…</>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
