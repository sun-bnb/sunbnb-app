'use client'

import { useState, useEffect, useRef } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'

import {
  previewSettlementAction,
  generateSettlementAction,
  closeSettlementAction,
  approveSettlementAction,
  markSettlementPaidAction,
  revertSettlementAction,
} from './actions'

// ─── Types ──────────────────────────────────────────────────────────────────

type SettlementStatus = 'DRAFT' | 'CLOSED' | 'APPROVED' | 'PAID'

interface Settlement {
  id: string
  accountId: string
  siteId: string
  siteName: string
  partnerCompany: string
  partnerBankAccount: string | null
  periodStart: string | Date
  periodEnd: string | Date
  grossRevenue: number
  totalTax: number
  commission: number
  netPayout: number
  currency: string
  status: SettlementStatus
  bankReference: string | null
  paidAt: string | Date | null
  notes: string | null
  invoiceCount: number
  createdAt: string | Date
}

interface UnsettledPartner {
  accountId: string
  company: string
  siteId: string
  siteName: string
  invoiceCount: number
  totalAmount: number
  oldestInvoice: string | Date
  newestInvoice: string | Date
}

interface DeemedProviderSite {
  id: string
  name: string
  accountId: string
  account: { company: string; bankAccount: string | null }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_COLORS: Record<SettlementStatus, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-gray-800', text: 'text-gray-400' },
  CLOSED: { bg: 'bg-amber-400/10', text: 'text-amber-400' },
  APPROVED: { bg: 'bg-blue-400/10', text: 'text-blue-400' },
  PAID: { bg: 'bg-green-400/10', text: 'text-green-400' },
}

const STATUS_LABELS: Record<SettlementStatus, string> = {
  DRAFT: 'Draft',
  CLOSED: 'Closed',
  APPROVED: 'Approved',
  PAID: 'Paid',
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SettlementsView({
  initialSettlements,
  unsettledPartners,
  deemedProviderSites,
}: {
  initialSettlements: Settlement[]
  unsettledPartners: UnsettledPartner[]
  deemedProviderSites: DeemedProviderSite[]
}) {
  // ── State ─────────────────────────────────────────────────────────────
  const [showGenerate, setShowGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [genErrors, setGenErrors] = useState<string[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState<string>(
    () => new Date().toISOString().split('T')[0]!
  )
  const [preview, setPreview] = useState<{
    invoiceCount: number
    grossRevenue: number
    totalTax: number
    commission: number
    netPayout: number
    invoices: {
      id: string
      invoicedAt: string
      totalAmount: number
      totalTax: number
      description: string
      type: 'reservation' | 'order'
    }[]
  } | null>(null)

  const [actionTarget, setActionTarget] = useState<Settlement | null>(null)
  const [actionType, setActionType] = useState<'close' | 'approve' | 'pay' | 'revert' | null>(null)
  const [acting, setActing] = useState(false)
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const [bankRef, setBankRef] = useState('')
  const [payNotes, setPayNotes] = useState('')

  const [statusFilter, setStatusFilter] = useState<SettlementStatus | ''>('')

  // ── Derived ───────────────────────────────────────────────────────────
  const selectedSite = deemedProviderSites.find((s) => s.id === selectedSiteId)
  const filteredSettlements = statusFilter
    ? initialSettlements.filter((s) => s.status === statusFilter)
    : initialSettlements

  // ── Generate handler ──────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedSite) return
    setGenerating(true)
    setGenErrors([])
    const result = await generateSettlementAction({
      accountId: selectedSite.accountId,
      siteId: selectedSite.id,
      periodStart,
      periodEnd,
    })
    setGenerating(false)
    if (result.status === 'ok') {
      setShowGenerate(false)
      setSelectedSiteId('')
      setPeriodStart('')
      setPeriodEnd(new Date().toISOString().split('T')[0]!)
      setPreview(null)
      window.location.reload()
    } else {
      setGenErrors(result.errors ?? ['Unknown error'])
    }
  }

  // Auto-generate preview when all inputs are set or change
  const previewAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    const site = deemedProviderSites.find((s) => s.id === selectedSiteId)
    if (!site || !periodStart || !periodEnd) {
      setPreview(null)
      return
    }

    // Cancel any in-flight preview request
    previewAbort.current?.abort()
    const controller = new AbortController()
    previewAbort.current = controller

    setPreviewing(true)
    setGenErrors([])
    setPreview(null)

    previewSettlementAction({
      accountId: site.accountId,
      siteId: site.id,
      periodStart,
      periodEnd,
    }).then((result) => {
      if (controller.signal.aborted) return
      setPreviewing(false)
      if (result.status === 'ok' && result.preview) {
        setPreview(result.preview)
      } else {
        setGenErrors(result.errors ?? ['Unknown error'])
      }
    })

    return () => { controller.abort() }
  }, [selectedSiteId, periodStart, periodEnd, deemedProviderSites])

  // ── Action handlers ───────────────────────────────────────────────────
  const openAction = (s: Settlement, type: 'close' | 'approve' | 'pay' | 'revert') => {
    setActionTarget(s)
    setActionType(type)
    setActionErrors([])
    setBankRef('')
    setPayNotes('')
  }

  const handleAction = async () => {
    if (!actionTarget || !actionType) return
    setActing(true)
    setActionErrors([])

    let result: { status: string; errors?: string[] }
    switch (actionType) {
      case 'close':
        result = await closeSettlementAction(actionTarget.id)
        break
      case 'approve':
        result = await approveSettlementAction(actionTarget.id)
        break
      case 'pay':
        result = await markSettlementPaidAction({
          settlementId: actionTarget.id,
          bankReference: bankRef,
          notes: payNotes || undefined,
        })
        break
      case 'revert':
        result = await revertSettlementAction(actionTarget.id)
        break
    }

    setActing(false)
    if (result.status === 'ok') {
      setActionTarget(null)
      setActionType(null)
      window.location.reload()
    } else {
      setActionErrors(result.errors ?? ['Unknown error'])
    }
  }

  const actionTitle: Record<string, string> = {
    close: 'Close Settlement',
    approve: 'Approve Settlement',
    pay: 'Record Bank Transfer',
    revert: 'Revert Settlement',
  }

  const actionDescription: Record<string, string> = {
    close: 'This will lock the settlement period. No more invoices can be assigned to this batch.',
    approve: 'This marks the settlement as reviewed and ready for bank transfer.',
    pay: 'Record the bank transfer details. This action marks the settlement as paid.',
    revert: 'This will move the settlement back to its previous status. If the settlement is in Draft, it will be deleted and all linked invoices will be unassigned.',
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="p-4">
      {/* Header */}
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Settlements</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage partner payouts. Generate settlement batches, review, approve,
          and record bank transfers.
        </p>
      </div>

      {/* Unsettled partners summary */}
      {unsettledPartners.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-400 mb-2">
            Unsettled Invoices
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {unsettledPartners.map((p) => (
              <div
                key={`${p.accountId}:${p.siteId}`}
                className="border border-amber-500/20 rounded-lg bg-amber-400/5 p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-200">
                    {p.company}
                  </span>
                  <span className="text-xs font-semibold text-amber-400">
                    {fmt(p.totalAmount)}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {p.siteName} · {p.invoiceCount} invoice{p.invoiceCount !== 1 ? 's' : ''}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {fmtDate(p.oldestInvoice)} – {fmtDate(p.newestInvoice)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-400">Settlement Batches</h3>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value as SettlementStatus | '')}
              sx={{ fontSize: '0.8rem', height: 32 }}
            >
              <MenuItem value="" sx={{ fontSize: '0.8rem' }}>All</MenuItem>
              <MenuItem value="DRAFT" sx={{ fontSize: '0.8rem' }}>Draft</MenuItem>
              <MenuItem value="CLOSED" sx={{ fontSize: '0.8rem' }}>Closed</MenuItem>
              <MenuItem value="APPROVED" sx={{ fontSize: '0.8rem' }}>Approved</MenuItem>
              <MenuItem value="PAID" sx={{ fontSize: '0.8rem' }}>Paid</MenuItem>
            </Select>
          </FormControl>
        </div>
        {!showGenerate && (
          <Button
            size="small"
            variant="contained"
            onClick={() => setShowGenerate(true)}
            sx={{ textTransform: 'none', fontSize: '0.8rem' }}
          >
            Generate Settlement
          </Button>
        )}
      </div>

      {/* Generate form */}
      {showGenerate && (
        <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">
            Generate New Settlement
          </h3>

          {genErrors.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
              {genErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-400">{e}</p>
              ))}
            </div>
          )}

          <div className="mb-3">
            <FormControl size="small" fullWidth>
              <InputLabel sx={{ fontSize: '0.8rem' }}>Site</InputLabel>
              <Select
                value={selectedSiteId}
                label="Site"
                onChange={(e) => setSelectedSiteId(e.target.value as string)}
                sx={{ fontSize: '0.8rem' }}
              >
                {deemedProviderSites.map((site) => (
                  <MenuItem key={site.id} value={site.id} sx={{ fontSize: '0.8rem' }}>
                    {site.name} — {site.account.company}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>

          {selectedSite && (
            <div className="text-xs text-gray-500 mb-3 flex items-center gap-3">
              <span>Partner: <strong className="text-gray-300">{selectedSite.account.company}</strong></span>
              {selectedSite.account.bankAccount && (
                <span>IBAN: <strong className="text-gray-300">{selectedSite.account.bankAccount}</strong></span>
              )}
              {!selectedSite.account.bankAccount && (
                <span className="text-red-500 font-medium">⚠ No IBAN on file</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <TextField
              label="Period start"
              type="date"
              size="small"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Period end"
              type="date"
              size="small"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </div>

          {/* Preview result */}
          {preview && (
            <div className="border border-gray-800 rounded-lg bg-gray-900 p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-gray-300">
                  Settlement Preview
                </h4>
                <span className="text-xs text-gray-400">
                  {preview.invoiceCount} invoice{preview.invoiceCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Totals */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Gross</div>
                  <div className="text-sm font-medium text-gray-300">{fmt(preview.grossRevenue)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Tax</div>
                  <div className="text-sm font-medium text-gray-300">{fmt(preview.totalTax)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Commission</div>
                  <div className="text-sm font-medium text-gray-300">{fmt(preview.commission)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Net Payout</div>
                  <div className="text-sm font-semibold text-gray-100">{fmt(preview.netPayout)}</div>
                </div>
              </div>

              {/* Invoice list */}
              <div className="border-t border-gray-800 pt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase tracking-wide">
                      <th className="text-left pb-1 font-medium">Date</th>
                      <th className="text-left pb-1 font-medium">Type</th>
                      <th className="text-left pb-1 font-medium">Description</th>
                      <th className="text-right pb-1 font-medium">Tax</th>
                      <th className="text-right pb-1 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.invoices.map((inv) => (
                      <tr key={inv.id} className="border-t border-gray-800">
                        <td className="py-1 text-gray-500">{fmtDate(inv.invoicedAt)}</td>
                        <td className="py-1">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            inv.type === 'reservation'
                              ? 'bg-blue-400/10 text-blue-400'
                              : 'bg-orange-400/10 text-orange-400'
                          }`}>
                            {inv.type === 'reservation' ? 'Reservation' : 'Order'}
                          </span>
                        </td>
                        <td className="py-1 text-gray-300">{inv.description}</td>
                        <td className="py-1 text-gray-500 text-right">{fmt(inv.totalTax)}</td>
                        <td className="py-1 text-gray-200 font-medium text-right">{fmt(inv.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {previewing && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <CircularProgress size={14} /> Loading preview…
              </div>
            )}
            {preview && (
              <Button
                variant="contained"
                size="small"
                color="success"
                onClick={handleGenerate}
                disabled={generating}
                sx={{ textTransform: 'none' }}
              >
                {generating ? (
                  <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Generating…</>
                ) : (
                  'Confirm & Generate'
                )}
              </Button>
            )}
            <Button
              size="small"
              onClick={() => { setShowGenerate(false); setGenErrors([]); setPreview(null) }}
              disabled={generating || previewing}
              sx={{ textTransform: 'none' }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Settlements list */}
      {filteredSettlements.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <svg className="w-12 h-12 mb-2 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
          </svg>
          <p className="text-sm">No settlements found</p>
          {statusFilter && (
            <p className="text-xs mt-1">
              Try clearing the status filter.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filteredSettlements.map((s) => {
          const color = STATUS_COLORS[s.status]
          return (
            <div
              key={s.id}
              className="border border-gray-800 rounded-lg bg-gray-900 p-4"
            >
              {/* Top row: partner + status */}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm font-medium text-gray-200">
                    {s.partnerCompany}
                  </div>
                  <div className="text-xs text-gray-500">
                    {s.siteName}
                  </div>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${color.bg} ${color.text}`}>
                  {STATUS_LABELS[s.status]}
                </span>
              </div>

              {/* Period */}
              <div className="text-xs text-gray-400 mb-3">
                {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)} · {s.invoiceCount} invoice{s.invoiceCount !== 1 ? 's' : ''}
              </div>

              {/* Amounts grid */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Gross</div>
                  <div className="text-sm font-medium text-gray-300">{fmt(s.grossRevenue, s.currency)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Tax</div>
                  <div className="text-sm font-medium text-gray-300">{fmt(s.totalTax, s.currency)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Commission</div>
                  <div className="text-sm font-medium text-gray-300">{fmt(s.commission, s.currency)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Net Payout</div>
                  <div className="text-sm font-semibold text-gray-100">{fmt(s.netPayout, s.currency)}</div>
                </div>
              </div>

              {/* Payment info (when paid) */}
              {s.status === 'PAID' && (
                <div className="text-xs text-green-400 bg-green-400/5 border border-green-500/20 rounded px-2 py-1.5 mb-3">
                  Paid {s.paidAt ? fmtDate(s.paidAt) : ''} · Ref: {s.bankReference}
                  {s.notes && <span className="text-green-500 block mt-0.5">{s.notes}</span>}
                </div>
              )}

              {/* IBAN info */}
              {s.status !== 'PAID' && s.partnerBankAccount && (
                <div className="text-xs text-gray-400 mb-3">
                  IBAN: {s.partnerBankAccount}
                </div>
              )}
              {s.status !== 'PAID' && !s.partnerBankAccount && (
                <div className="text-xs text-red-500 mb-3">
                  ⚠ No IBAN on file for this partner
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {s.status === 'DRAFT' && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => openAction(s, 'close')}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    Close
                  </Button>
                )}
                {s.status === 'CLOSED' && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => openAction(s, 'approve')}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    Approve
                  </Button>
                )}
                {s.status === 'APPROVED' && (
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    onClick={() => openAction(s, 'pay')}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    Record Payment
                  </Button>
                )}
                {/* Revert always available */}
                <Button
                  size="small"
                  color="warning"
                  onClick={() => openAction(s, 'revert')}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                  {s.status === 'DRAFT' ? 'Delete' : 'Revert'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action dialog */}
      <Dialog
        open={!!actionTarget && !!actionType}
        onClose={() => { setActionTarget(null); setActionType(null) }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: '1rem' }}>
          {actionType ? actionTitle[actionType] : ''}
        </DialogTitle>
        <DialogContent>
          {actionErrors.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
              {actionErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-400">{e}</p>
              ))}
            </div>
          )}

          <DialogContentText sx={{ fontSize: '0.85rem', mb: 2 }}>
            {actionType ? actionDescription[actionType] : ''}
          </DialogContentText>

          {actionTarget && (
            <div className="text-xs text-gray-400 mb-3 space-y-0.5">
              <div>Partner: <strong className="text-gray-200">{actionTarget.partnerCompany}</strong></div>
              <div>Site: <strong className="text-gray-200">{actionTarget.siteName}</strong></div>
              <div>Net payout: <strong className="text-gray-200">{fmt(actionTarget.netPayout, actionTarget.currency)}</strong></div>
            </div>
          )}

          {/* Extra fields for pay action */}
          {actionType === 'pay' && (
            <div className="space-y-3 mt-2">
              <TextField
                label="Bank reference"
                size="small"
                fullWidth
                value={bankRef}
                onChange={(e) => setBankRef(e.target.value)}
                placeholder="e.g. SEPA-2025-001"
                required
              />
              <TextField
                label="Notes (optional)"
                size="small"
                fullWidth
                multiline
                rows={2}
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Any additional notes about this transfer"
              />
              {actionTarget?.partnerBankAccount && (
                <div className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-1.5">
                  Transfer to IBAN: <strong className="text-gray-200">{actionTarget.partnerBankAccount}</strong>
                </div>
              )}
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setActionTarget(null); setActionType(null) }}
            disabled={acting}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color={actionType === 'revert' ? 'warning' : actionType === 'pay' ? 'success' : 'primary'}
            onClick={handleAction}
            disabled={acting || (actionType === 'pay' && !bankRef.trim())}
            sx={{ textTransform: 'none' }}
          >
            {acting ? (
              <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Processing…</>
            ) : (
              actionType === 'revert'
                ? (actionTarget?.status === 'DRAFT' ? 'Delete' : 'Revert')
                : actionType === 'pay'
                  ? 'Record Payment'
                  : actionType === 'close'
                    ? 'Close'
                    : 'Approve'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
