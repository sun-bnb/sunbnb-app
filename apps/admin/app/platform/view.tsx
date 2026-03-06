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
import CreditCardIcon from '@mui/icons-material/CreditCard'

import { savePlatformVatConfig, deletePlatformVatConfig, savePaymentProcessingFee, deletePaymentProcessingFee } from './actions'

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

type PaymentProcessingFee = { id: string; name: string; fixedAmount: number | null; percentage: number | null; currency: string }

export default function PlatformView({
  initialConfigs,
  paymentProcessingFee: initialProcessingFee,
}: {
  initialConfigs: VatConfig[]
  paymentProcessingFee: PaymentProcessingFee | null
}) {
  const [configs] = useState<VatConfig[]>(initialConfigs)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<VatConfig | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Payment processing fee state (singleton)
  const [processingFee, setProcessingFee] = useState<PaymentProcessingFee | null>(initialProcessingFee)
  const [ppEditing, setPpEditing] = useState(false)
  const [ppForm, setPpForm] = useState<{ id?: string; name: string; fixedAmount: string; percentage: string; currency: string }>({ name: '', fixedAmount: '', percentage: '', currency: 'EUR' })
  const [ppSaving, setPpSaving] = useState(false)
  const [ppErrors, setPpErrors] = useState<string[]>([])
  const [ppConfirmDelete, setPpConfirmDelete] = useState(false)
  const [ppDeleting, setPpDeleting] = useState(false)

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

  // Payment processing fee handlers

  const handlePpSave = async () => {
    setPpSaving(true)
    setPpErrors([])
    const result = await savePaymentProcessingFee({
      id: ppForm.id,
      name: ppForm.name,
      fixedAmount: ppForm.fixedAmount ? parseFloat(ppForm.fixedAmount) : null,
      percentage: ppForm.percentage ? parseFloat(ppForm.percentage) : null,
      currency: ppForm.currency,
    })
    setPpSaving(false)
    if (result.status === 'ok') {
      setPpEditing(false)
      setProcessingFee({
        id: result.id!,
        name: ppForm.name.trim(),
        fixedAmount: ppForm.fixedAmount ? parseFloat(ppForm.fixedAmount) : null,
        percentage: ppForm.percentage ? parseFloat(ppForm.percentage) : null,
        currency: ppForm.currency.trim().toUpperCase(),
      })
    } else {
      setPpErrors(result.errors ?? ['Unknown error'])
    }
  }

  const handlePpDelete = async () => {
    if (!processingFee) return
    setPpDeleting(true)
    await deletePaymentProcessingFee(processingFee.id)
    setPpDeleting(false)
    setProcessingFee(null)
    setPpConfirmDelete(false)
  }

  return (
    <div className="p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Platform Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage platform VAT registrations used for deemed-provider invoicing.
        </p>
      </div>

      {/* Config list */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">VAT Registrations</h3>
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
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
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
            className="border border-gray-800 rounded-lg bg-gray-900 p-4 mb-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/10 text-purple-400 text-xs font-bold">
                    {config.countryCode}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-200">
                      {config.companyName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {config.vatNumber}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-600 mt-1 ml-10">
                  {config.companyAddress}
                </div>
                {config.ossRegistered && (
                  <div className="flex items-center gap-1 mt-1 ml-10">
                    <CheckCircleIcon sx={{ fontSize: 12 }} className="text-green-400" />
                    <span className="text-[10px] text-green-400 font-medium">OSS registered</span>
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
        <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">
            {form.id ? 'Edit VAT Registration' : 'New VAT Registration'}
          </h3>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-400">{e}</p>
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
              <span className="text-sm text-gray-300">OSS registered</span>
              <p className="text-xs text-gray-500">
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

      {/* Payment Processing Fee (singleton) */}
      <div className="border-t border-gray-800 mt-6 pt-6 mb-8">
        <div className="flex items-center gap-2 mb-1">
          <CreditCardIcon sx={{ fontSize: 18 }} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Payment Processing Fee</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          The payment processor cost applied to every transaction (e.g. 0.25&nbsp;&euro; + 1.5%).
        </p>

        {/* Missing warning + add button */}
        {!processingFee && !ppEditing && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-4 flex items-start gap-3">
            <CreditCardIcon sx={{ fontSize: 28, mt: 0.25 }} className="text-amber-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">Payment processing fee not configured</p>
              <p className="text-xs text-gray-400 mt-0.5">
                This setting is required for accurate fee calculations. Please configure it now.
              </p>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => {
                  setPpForm({ name: '', fixedAmount: '', percentage: '', currency: 'EUR' })
                  setPpErrors([])
                  setPpEditing(true)
                }}
                sx={{ textTransform: 'none', fontSize: '0.8rem', mt: 1.5 }}
              >
                Configure processing fee
              </Button>
            </div>
          </div>
        )}

        {/* Existing fee card */}
        {processingFee && !ppEditing && (() => {
          const parts: string[] = []
          if (processingFee.fixedAmount != null) parts.push(`${processingFee.fixedAmount} ${processingFee.currency}`)
          if (processingFee.percentage != null) parts.push(`${processingFee.percentage}%`)
          const display = parts.join(' + ') || '\u2014'

          return (
            <div className="border border-gray-800 rounded-lg bg-gray-900 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/10 text-purple-400">
                      <CreditCardIcon sx={{ fontSize: 16 }} />
                    </span>
                    <div>
                      <div className="text-sm font-medium text-gray-200">{processingFee.name}</div>
                      <div className="text-xs text-gray-500">{display}</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setPpForm({
                        id: processingFee.id,
                        name: processingFee.name,
                        fixedAmount: processingFee.fixedAmount?.toString() ?? '',
                        percentage: processingFee.percentage?.toString() ?? '',
                        currency: processingFee.currency,
                      })
                      setPpErrors([])
                      setPpEditing(true)
                    }}
                  >
                    <EditIcon fontSize="small" className="text-gray-400" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setPpConfirmDelete(true)}>
                    <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                  </IconButton>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Edit / Create form */}
        {ppEditing && (
          <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">
              {ppForm.id ? 'Edit Processing Fee' : 'New Processing Fee'}
            </h3>

            {ppErrors.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
                {ppErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400">{e}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-4 gap-3 mb-3">
              <TextField
                label="Name"
                size="small"
                value={ppForm.name}
                onChange={(e) => setPpForm({ ...ppForm, name: e.target.value })}
                placeholder="e.g. Stripe"
              />
              <TextField
                label="Fixed amount"
                size="small"
                type="number"
                value={ppForm.fixedAmount}
                onChange={(e) => setPpForm({ ...ppForm, fixedAmount: e.target.value })}
                placeholder="e.g. 0.25"
              />
              <TextField
                label="Percentage"
                size="small"
                type="number"
                value={ppForm.percentage}
                onChange={(e) => setPpForm({ ...ppForm, percentage: e.target.value })}
                placeholder="e.g. 1.5"
              />
              <TextField
                label="Currency"
                size="small"
                value={ppForm.currency}
                onChange={(e) => setPpForm({ ...ppForm, currency: e.target.value })}
                placeholder="EUR"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="contained"
                size="small"
                onClick={handlePpSave}
                disabled={ppSaving}
                sx={{ textTransform: 'none' }}
              >
                {ppSaving ? (
                  <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving&hellip;</>
                ) : (
                  ppForm.id ? 'Save changes' : 'Create'
                )}
              </Button>
              <Button
                size="small"
                onClick={() => setPpEditing(false)}
                disabled={ppSaving}
                sx={{ textTransform: 'none' }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete payment processing fee confirmation */}
      <Dialog open={ppConfirmDelete} onClose={() => setPpConfirmDelete(false)}>
        <DialogTitle>Delete processing fee?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove the <strong>{processingFee?.name}</strong> payment processing fee configuration?
            Fee calculations will not work correctly without this setting.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPpConfirmDelete(false)}
            disabled={ppDeleting}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handlePpDelete}
            disabled={ppDeleting}
            sx={{ textTransform: 'none' }}
          >
            {ppDeleting ? (
              <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Deleting&hellip;</>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
