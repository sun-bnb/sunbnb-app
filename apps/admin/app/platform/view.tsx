'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import BusinessIcon from '@mui/icons-material/Business'

import { saveBusinessEntity } from './actions'

type BusinessEntity = { companyName: string | null; companyAddress: string | null; businessId: string | null; vatId: string | null; contactEmail: string | null; contactPhone: string | null }

export default function PlatformView({
  businessEntity: initialEntity,
}: {
  businessEntity?: BusinessEntity
}) {
  // Business entity state
  const [entity, setEntity] = useState<BusinessEntity | undefined>(initialEntity)
  const [beEditing, setBeEditing] = useState(false)
  const [beForm, setBeForm] = useState({ companyName: '', companyAddress: '', businessId: '', vatId: '', contactEmail: '', contactPhone: '' })
  const [beSaving, setBeSaving] = useState(false)
  const [beErrors, setBeErrors] = useState<string[]>([])

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
    </div>
  )
}
