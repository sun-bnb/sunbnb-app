'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import BusinessIcon from '@mui/icons-material/Business'
import SettingsIcon from '@mui/icons-material/Settings'

import { saveBusinessEntity, saveSettings, deleteSettings, type SettingsRow } from './actions'

type BusinessEntity = { companyName: string | null; companyAddress: string | null; businessId: string | null; vatId: string | null; contactEmail: string | null; contactPhone: string | null }

export default function PlatformView({
  businessEntity: initialEntity,
  initialSettings,
}: {
  businessEntity?: BusinessEntity
  initialSettings: SettingsRow[]
}) {
  // Business entity state
  const [entity, setEntity] = useState<BusinessEntity | undefined>(initialEntity)
  const [beEditing, setBeEditing] = useState(false)
  const [beForm, setBeForm] = useState({ companyName: '', companyAddress: '', businessId: '', vatId: '', contactEmail: '', contactPhone: '' })
  const [beSaving, setBeSaving] = useState(false)
  const [beErrors, setBeErrors] = useState<string[]>([])

  // Settings state
  const [settingsList, setSettingsList] = useState<SettingsRow[]>(initialSettings)
  const [sEditing, setSEditing] = useState(false)
  const [sForm, setSForm] = useState({ id: '', country: '', currency: '', vat: '' })
  const [sSaving, setSSaving] = useState(false)
  const [sErrors, setSErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<SettingsRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const handleBeSave = async () => {
    setBeSaving(true)
    setBeErrors([])
    const result = await saveBusinessEntity(beForm)
    setBeSaving(false)
    if (result.status === 'ok') {
      setBeEditing(false)
      setEntity(beForm)
    } else {
      setBeErrors(result.errors ?? ['Unknown error'])
    }
  }

  const startBeEdit = () => {
    setBeForm({
      companyName: entity?.companyName ?? '',
      companyAddress: entity?.companyAddress ?? '',
      businessId: entity?.businessId ?? '',
      vatId: entity?.vatId ?? '',
      contactEmail: entity?.contactEmail ?? '',
      contactPhone: entity?.contactPhone ?? '',
    })
    setBeErrors([])
    setBeEditing(true)
  }

  return (
    <div className="p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Platform Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage platform-level configuration.
        </p>
      </div>

      {/* ── Business Entity ─────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <BusinessIcon sx={{ fontSize: 18 }} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Business Entity</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          Default company information used in legal pages, terms of service, and footer text.
        </p>

        {!entity?.companyName && !beEditing && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-4 flex items-start gap-3">
            <BusinessIcon sx={{ fontSize: 28, mt: 0.25 }} className="text-amber-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">Business entity not configured</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Configure the default platform operator details shown in legal pages and footers.
              </p>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon fontSize="small" />}
                onClick={startBeEdit}
                sx={{ textTransform: 'none', fontSize: '0.8rem', mt: 1.5 }}
              >
                Configure business entity
              </Button>
            </div>
          </div>
        )}

        {entity?.companyName && !beEditing && (
          <div className="border border-gray-800 rounded-lg bg-gray-900 p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/10 text-purple-400">
                    <BusinessIcon sx={{ fontSize: 16 }} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-200">{entity.companyName}</div>
                    {entity.companyAddress && <div className="text-xs text-gray-500">{entity.companyAddress}</div>}
                  </div>
                </div>
                <div className="ml-10 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  {entity.businessId && <div><span className="text-gray-500">Business ID:</span> <span className="text-gray-300">{entity.businessId}</span></div>}
                  {entity.vatId && <div><span className="text-gray-500">VAT ID:</span> <span className="text-gray-300">{entity.vatId}</span></div>}
                  {entity.contactEmail && <div><span className="text-gray-500">Email:</span> <span className="text-gray-300">{entity.contactEmail}</span></div>}
                  {entity.contactPhone && <div><span className="text-gray-500">Phone:</span> <span className="text-gray-300">{entity.contactPhone}</span></div>}
                </div>
              </div>
              <IconButton size="small" onClick={startBeEdit}>
                <EditIcon fontSize="small" className="text-gray-400" />
              </IconButton>
            </div>
          </div>
        )}

        {beEditing && (
          <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">Business Entity</h3>

            {beErrors.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
                {beErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400">{e}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <TextField
                label="Company name"
                size="small"
                value={beForm.companyName}
                onChange={(e) => setBeForm({ ...beForm, companyName: e.target.value })}
                placeholder="e.g. Acme Platforms Oy"
                required
              />
              <TextField
                label="Business ID"
                size="small"
                value={beForm.businessId}
                onChange={(e) => setBeForm({ ...beForm, businessId: e.target.value })}
                placeholder="e.g. 1234567-8"
              />
              <TextField
                label="VAT ID"
                size="small"
                value={beForm.vatId}
                onChange={(e) => setBeForm({ ...beForm, vatId: e.target.value })}
                placeholder="e.g. FI12345678"
              />
              <TextField
                label="Contact email"
                size="small"
                value={beForm.contactEmail}
                onChange={(e) => setBeForm({ ...beForm, contactEmail: e.target.value })}
                placeholder="e.g. info@example.com"
              />
              <TextField
                label="Contact phone"
                size="small"
                value={beForm.contactPhone}
                onChange={(e) => setBeForm({ ...beForm, contactPhone: e.target.value })}
                placeholder="e.g. +358 40 123 4567"
              />
              <div className="col-span-2">
                <TextField
                  label="Registered address"
                  size="small"
                  fullWidth
                  value={beForm.companyAddress}
                  onChange={(e) => setBeForm({ ...beForm, companyAddress: e.target.value })}
                  placeholder="e.g. Kaivokatu 10 A, 00100 Helsinki, Finland"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="contained"
                size="small"
                onClick={handleBeSave}
                disabled={beSaving}
                sx={{ textTransform: 'none' }}
              >
                {beSaving ? (
                  <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving&hellip;</>
                ) : (
                  'Save'
                )}
              </Button>
              <Button
                size="small"
                onClick={() => setBeEditing(false)}
                disabled={beSaving}
                sx={{ textTransform: 'none' }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Settings (Country / Currency / Tax Rate) ──────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <SettingsIcon sx={{ fontSize: 18 }} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-200">Settings</h3>
          </div>
          {!sEditing && (
            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() => {
                setSForm({ id: '', country: '', currency: 'EUR', vat: '' })
                setSErrors([])
                setSEditing(true)
              }}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              Add
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          Country / currency configurations referenced by service fees. Tax rate is used for platform invoice VAT.
        </p>

        {/* Settings form (create / edit) */}
        {sEditing && (
          <div className="border border-blue-500/30 rounded-lg bg-blue-400/5 p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">
              {sForm.id ? 'Edit Settings' : 'New Settings'}
            </h3>

            {sErrors.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
                {sErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400">{e}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-3">
              <TextField
                label="Country"
                size="small"
                value={sForm.country}
                onChange={(e) => setSForm({ ...sForm, country: e.target.value })}
                placeholder="e.g. FI"
                required
                inputProps={{ maxLength: 3, style: { textTransform: 'uppercase' } }}
              />
              <TextField
                label="Currency"
                size="small"
                value={sForm.currency}
                onChange={(e) => setSForm({ ...sForm, currency: e.target.value })}
                placeholder="e.g. EUR"
                required
                inputProps={{ maxLength: 3, style: { textTransform: 'uppercase' } }}
              />
              <TextField
                label="Tax rate (%)"
                size="small"
                value={sForm.vat}
                onChange={(e) => setSForm({ ...sForm, vat: e.target.value })}
                placeholder="e.g. 25.5"
                type="number"
                inputProps={{ step: '0.1', min: '0', max: '100' }}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="contained"
                size="small"
                onClick={async () => {
                  setSSaving(true)
                  setSErrors([])
                  const result = await saveSettings({
                    id: sForm.id || undefined,
                    country: sForm.country,
                    currency: sForm.currency,
                    vat: sForm.vat,
                  })
                  setSSaving(false)
                  if (result.status === 'ok' && result.settings) {
                    setSEditing(false)
                    if (sForm.id) {
                      setSettingsList(prev => prev.map(s => s.id === sForm.id ? result.settings! : s))
                    } else {
                      setSettingsList(prev => [...prev, result.settings!])
                    }
                  } else {
                    setSErrors(result.errors ?? ['Unknown error'])
                  }
                }}
                disabled={sSaving}
                sx={{ textTransform: 'none' }}
              >
                {sSaving ? (
                  <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving&hellip;</>
                ) : (
                  'Save'
                )}
              </Button>
              <Button
                size="small"
                onClick={() => setSEditing(false)}
                disabled={sSaving}
                sx={{ textTransform: 'none' }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Settings list */}
        {settingsList.length === 0 && !sEditing && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-4 flex items-start gap-3">
            <SettingsIcon sx={{ fontSize: 28, mt: 0.25 }} className="text-amber-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">No settings configured</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Add at least one settings entry so service fees can reference it.
              </p>
            </div>
          </div>
        )}

        {settingsList.map((s) => (
          <div key={s.id} className="border border-gray-800 rounded-lg bg-gray-900 p-4 mb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-400/10 text-blue-400">
                  <SettingsIcon sx={{ fontSize: 16 }} />
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-200">
                    {s.country || '—'} / {s.currency || '—'}
                  </div>
                  <div className="text-xs text-gray-500">
                    Tax rate: {s.vat != null ? `${s.vat}%` : 'Not set'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  size="small"
                  onClick={() => {
                    setSForm({
                      id: s.id,
                      country: s.country ?? '',
                      currency: s.currency ?? '',
                      vat: s.vat != null ? String(s.vat) : '',
                    })
                    setSErrors([])
                    setSEditing(true)
                  }}
                >
                  <EditIcon fontSize="small" className="text-gray-400" />
                </IconButton>
                <IconButton size="small" onClick={() => { setDeleteTarget(s); setDeleteError(null) }}>
                  <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                </IconButton>
              </div>
            </div>
          </div>
        ))}

        {/* Delete confirmation dialog */}
        <Dialog
          open={!!deleteTarget}
          onClose={() => { if (!deleting) setDeleteTarget(null) }}
        >
          <DialogTitle>Delete settings?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              This will permanently delete the settings entry
              <strong> {deleteTarget?.country} / {deleteTarget?.currency}</strong>.
              This cannot be undone.
            </DialogContentText>
            {deleteError && (
              <div className="mt-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2">
                <p className="text-xs text-red-400">{deleteError}</p>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteTarget(null)} disabled={deleting} sx={{ textTransform: 'none' }}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={deleting}
              onClick={async () => {
                if (!deleteTarget) return
                setDeleting(true)
                setDeleteError(null)
                const result = await deleteSettings(deleteTarget.id)
                setDeleting(false)
                if (result.status === 'ok') {
                  setSettingsList(prev => prev.filter(s => s.id !== deleteTarget.id))
                  setDeleteTarget(null)
                } else {
                  setDeleteError(result.errors?.[0] ?? 'Delete failed')
                }
              }}
              sx={{ textTransform: 'none' }}
            >
              {deleting ? <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Deleting&hellip;</> : 'Delete'}
            </Button>
          </DialogActions>
        </Dialog>
      </div>
    </div>
  )
}
