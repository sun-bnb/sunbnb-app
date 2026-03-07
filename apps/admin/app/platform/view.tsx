'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
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
import CreditCardIcon from '@mui/icons-material/CreditCard'

import { savePaymentProcessingFee, deletePaymentProcessingFee } from './actions'

type PaymentProcessingFee = { id: string; name: string; fixedAmount: number | null; percentage: number | null; currency: string }

export default function PlatformView({
  paymentProcessingFee: initialProcessingFee,
}: {
  paymentProcessingFee: PaymentProcessingFee | null
}) {
  // Payment processing fee state (singleton)
  const [processingFee, setProcessingFee] = useState<PaymentProcessingFee | null>(initialProcessingFee)
  const [ppEditing, setPpEditing] = useState(false)
  const [ppForm, setPpForm] = useState<{ id?: string; name: string; fixedAmount: string; percentage: string; currency: string }>({ name: '', fixedAmount: '', percentage: '', currency: 'EUR' })
  const [ppSaving, setPpSaving] = useState(false)
  const [ppErrors, setPpErrors] = useState<string[]>([])
  const [ppConfirmDelete, setPpConfirmDelete] = useState(false)
  const [ppDeleting, setPpDeleting] = useState(false)

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
          Manage platform-level configuration for fee calculations.
        </p>
      </div>

      {/* Payment Processing Fee (singleton) */}
      <div className="mb-8">
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
