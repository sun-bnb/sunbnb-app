"use client"

import { useState } from "react"
import TextField from "@mui/material/TextField"
import MenuItem from "@mui/material/MenuItem"
import Button from "@mui/material/Button"
import IconButton from "@mui/material/IconButton"
import Dialog from "@mui/material/Dialog"
import DialogTitle from "@mui/material/DialogTitle"
import DialogContent from "@mui/material/DialogContent"
import DialogContentText from "@mui/material/DialogContentText"
import DialogActions from "@mui/material/DialogActions"
import CircularProgress from "@mui/material/CircularProgress"
import EditIcon from "@mui/icons-material/Edit"
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline"
import PercentIcon from "@mui/icons-material/Percent"
import AttachMoneyIcon from "@mui/icons-material/AttachMoney"
import BusinessIcon from "@mui/icons-material/Business"
import AddIcon from "@mui/icons-material/Add"
import Link from "next/link"

import {
  upsertCustomSubscription,
  clearCustomSubscription,
  waiveAllServiceFees,
  getPartnerDetail,
  setFeatureOverride,
} from "./actions"
import {
  saveServiceFee,
  deleteServiceFee,
  getFeesByAccount,
  type FeeWithRelations,
} from "../../fees/actions"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Settings {
  id: string
  country: string | null
  vat: number | null
  currency: string | null
}

type ServiceCode = { id: string; code: string; description: string | null }

type FormData = {
  id?: string
  settingsId: string
  chargeType: string
  feeAmount: string
  percentage: string
  serviceCode: string
}

/** One row from the feature catalog, pre-resolved server-side. */
type FeatureCatalogRow = {
  key: string
  label: string
  description: string
  tierDefault: boolean
  effectiveValue: boolean
  /** null = inheriting tier default; true/false = explicit override */
  override: boolean | null
}

const emptyForm: FormData = {
  settingsId: "",
  chargeType: "percentage",
  feeAmount: "",
  percentage: "",
  serviceCode: "",
}

const chargeTypes = [
  { value: "percentage", label: "Percentage" },
  { value: "fixed", label: "Fixed amount" },
]

export interface PartnerDetailViewProps {
  accountId: string
  company: string
  ownerEmail: string
  ownerName: string | null
  baseTier: string
  baseMonthlyPrice: number
  basePlanMaxSites: number | null
  currentSiteCount: number
  customMaxSites: number | null
  hasCustomSubscription: boolean
  effectiveMaxSites: number
  isCustomMaxSites: boolean
  initialAccountFees: FeeWithRelations[]
  settings: Settings[]
  serviceCodes: ServiceCode[]
  featureCatalog: FeatureCatalogRow[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function settingsLabel(s: Settings): string {
  return [s.country, s.currency].filter(Boolean).join(" · ") || s.id.slice(0, 8)
}

function tierBadgeColor(tier: string) {
  if (tier === "BUSINESS") return "bg-purple-400/20 text-purple-300"
  if (tier === "PRO") return "bg-blue-400/20 text-blue-300"
  return "bg-gray-700 text-gray-300"
}

// ─── Fee card (reused pattern from fees/view.tsx) ────────────────────────────

function FeeCard({
  fee,
  onEdit,
  onDelete,
}: {
  fee: FeeWithRelations
  onEdit: () => void
  onDelete: () => void
}) {
  const parts: string[] = []
  if (fee.feeAmount != null) parts.push(`${fee.feeAmount} ${fee.settings.currency ?? ""}`.trim())
  if (fee.percentage != null) parts.push(`${fee.percentage}%`)
  const display = parts.join(" + ") || "—"

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900 p-4 mb-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/10 text-purple-400">
              {fee.chargeType === "percentage" ? (
                <PercentIcon sx={{ fontSize: 16 }} />
              ) : (
                <AttachMoneyIcon sx={{ fontSize: 16 }} />
              )}
            </span>
            <div>
              <div className="text-sm font-medium text-gray-200">{fee.serviceCode}</div>
              <div className="text-xs text-gray-500">
                {fee.chargeType} &middot; {display}
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-600 mt-1 ml-10">
            Settings: {settingsLabel(fee.settings)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton size="small" onClick={onEdit}>
            <EditIcon fontSize="small" className="text-gray-400" />
          </IconButton>
          <IconButton size="small" onClick={onDelete}>
            <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

// ─── Fee form (reused pattern from fees/view.tsx) ────────────────────────────

function FeeForm({
  form,
  setForm,
  settings,
  serviceCodes,
  saving,
  errors,
  onSave,
  onCancel,
}: {
  form: FormData
  setForm: (f: FormData) => void
  settings: Settings[]
  serviceCodes: ServiceCode[]
  saving: boolean
  errors: string[]
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">
        {form.id ? "Edit Commission Fee" : "New Commission Fee"}
      </h3>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-400">{e}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-3">
        <TextField
          select
          label="Settings"
          size="small"
          value={form.settingsId}
          onChange={(e) => setForm({ ...form, settingsId: e.target.value })}
        >
          {settings.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {settingsLabel(s)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Charge type"
          size="small"
          value={form.chargeType}
          onChange={(e) => setForm({ ...form, chargeType: e.target.value })}
        >
          {chargeTypes.map((ct) => (
            <MenuItem key={ct.value} value={ct.value}>
              {ct.label}
            </MenuItem>
          ))}
        </TextField>
        {form.chargeType === "fixed" ? (
          <TextField
            label="Fee amount"
            size="small"
            type="number"
            value={form.feeAmount}
            onChange={(e) => setForm({ ...form, feeAmount: e.target.value })}
            placeholder="e.g. 2.50"
          />
        ) : (
          <TextField
            label="Percentage"
            size="small"
            type="number"
            value={form.percentage}
            onChange={(e) => setForm({ ...form, percentage: e.target.value })}
            placeholder="e.g. 5"
          />
        )}
      </div>

      <TextField
        select
        label="Service code"
        size="small"
        fullWidth
        value={form.serviceCode}
        onChange={(e) => setForm({ ...form, serviceCode: e.target.value })}
        sx={{ mb: 1.5 }}
      >
        {serviceCodes.length === 0 && (
          <MenuItem disabled value="">
            No service codes defined
          </MenuItem>
        )}
        {serviceCodes.map((sc) => (
          <MenuItem key={sc.id} value={sc.code}>
            {sc.code}{sc.description ? ` — ${sc.description}` : ""}
          </MenuItem>
        ))}
      </TextField>

      <div className="flex items-center gap-2">
        <Button
          variant="contained"
          size="small"
          onClick={onSave}
          disabled={saving}
          sx={{ textTransform: "none" }}
        >
          {saving ? (
            <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving&hellip;</>
          ) : (
            form.id ? "Save changes" : "Add fee"
          )}
        </Button>
        <Button
          size="small"
          onClick={onCancel}
          disabled={saving}
          sx={{ textTransform: "none" }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export default function PartnerDetailView({
  accountId,
  company,
  ownerEmail,
  ownerName,
  baseTier,
  baseMonthlyPrice,
  basePlanMaxSites,
  currentSiteCount,
  customMaxSites,
  hasCustomSubscription,
  effectiveMaxSites,
  isCustomMaxSites,
  initialAccountFees,
  settings,
  serviceCodes,
  featureCatalog,
}: PartnerDetailViewProps) {
  // ── Custom subscription state ──────────────────────────────────────────────
  const [maxSitesInput, setMaxSitesInput] = useState<string>(
    customMaxSites != null ? String(customMaxSites) : "",
  )
  const [maxSitesSaving, setMaxSitesSaving] = useState(false)
  const [maxSitesErrors, setMaxSitesErrors] = useState<string[]>([])
  const [maxSitesClearing, setMaxSitesClearing] = useState(false)

  // ── Features state ────────────────────────────────────────────────────────
  const [featureRows, setFeatureRows] = useState<FeatureCatalogRow[]>(featureCatalog)
  const [featureSaving, setFeatureSaving] = useState<Record<string, boolean>>({})
  const [featureErrors, setFeatureErrors] = useState<Record<string, string[]>>({})

  // ── Commission (account fee) state ─────────────────────────────────────────
  const [accountFees, setAccountFees] = useState<FeeWithRelations[]>(initialAccountFees)
  const [feeEditing, setFeeEditing] = useState(false)
  const [feeForm, setFeeForm] = useState<FormData>(emptyForm)
  const [feeSaving, setFeeSaving] = useState(false)
  const [feeErrors, setFeeErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<FeeWithRelations | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [waiving, setWaiving] = useState(false)
  const [waiveErrors, setWaiveErrors] = useState<string[]>([])

  const makeNewForm = (): FormData => ({
    ...emptyForm,
    settingsId: settings[0]?.id ?? "",
  })

  const makeEditForm = (fee: FeeWithRelations): FormData => ({
    id: fee.id,
    settingsId: fee.settingsId,
    chargeType: fee.chargeType,
    feeAmount: fee.feeAmount?.toString() ?? "",
    percentage: fee.percentage?.toString() ?? "",
    serviceCode: fee.serviceCode,
  })

  // ── Custom maxSites handlers ───────────────────────────────────────────────

  const handleSaveMaxSites = async () => {
    setMaxSitesSaving(true)
    setMaxSitesErrors([])
    const trimmed = maxSitesInput.trim()
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10)
    const result = await upsertCustomSubscription(accountId, { maxSites: parsed })
    setMaxSitesSaving(false)
    if (result.status !== "ok") {
      setMaxSitesErrors(result.errors ?? ["Unknown error"])
    }
  }

  const handleClearMaxSites = async () => {
    setMaxSitesClearing(true)
    setMaxSitesErrors([])
    await clearCustomSubscription(accountId)
    setMaxSitesInput("")
    setMaxSitesClearing(false)
  }

  // ── Feature override handlers ─────────────────────────────────────────────

  const handleFeatureOverride = async (featureKey: string, value: boolean | null) => {
    setFeatureSaving((prev) => ({ ...prev, [featureKey]: true }))
    setFeatureErrors((prev) => ({ ...prev, [featureKey]: [] }))

    const result = await setFeatureOverride(accountId, featureKey, value)

    if (result.status === "ok") {
      // Refresh the partner detail to get updated resolved values
      const refreshed = await getPartnerDetail(accountId)
      if (refreshed) {
        // Rebuild featureRows from updated customSubscription + previously computed catalog
        // We don't get the catalog from getPartnerDetail, so we patch optimistically
        setFeatureRows((prev) =>
          prev.map((row) =>
            row.key === featureKey
              ? {
                  ...row,
                  override: value,
                  effectiveValue: value ?? row.tierDefault,
                }
              : row,
          ),
        )
      }
    } else {
      setFeatureErrors((prev) => ({
        ...prev,
        [featureKey]: result.errors ?? ["Unknown error"],
      }))
    }

    setFeatureSaving((prev) => ({ ...prev, [featureKey]: false }))
  }

  // ── Commission fee handlers ────────────────────────────────────────────────

  const handleFeeSave = async () => {
    setFeeSaving(true)
    setFeeErrors([])
    const result = await saveServiceFee({
      id: feeForm.id,
      settingsId: feeForm.settingsId,
      accountId,
      chargeType: feeForm.chargeType,
      feeAmount: feeForm.feeAmount ? parseFloat(feeForm.feeAmount) : null,
      percentage: feeForm.percentage ? parseFloat(feeForm.percentage) : null,
      serviceCode: feeForm.serviceCode,
    })
    setFeeSaving(false)
    if (result.status === "ok") {
      setFeeEditing(false)
      const refreshed = await getFeesByAccount(accountId)
      setAccountFees(refreshed)
    } else {
      setFeeErrors(result.errors ?? ["Unknown error"])
    }
  }

  const handleFeeDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await deleteServiceFee(deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    const refreshed = await getFeesByAccount(accountId)
    setAccountFees(refreshed)
  }

  const handleWaiveAll = async () => {
    setWaiving(true)
    setWaiveErrors([])
    const result = await waiveAllServiceFees(accountId)
    setWaiving(false)
    if (result.status === "ok") {
      const refreshed = await getFeesByAccount(accountId)
      setAccountFees(refreshed)
    } else {
      setWaiveErrors(result.errors ?? ["Unknown error"])
    }
  }

  return (
    <div className="p-4">
      {/* ── Back link ──────────────────────────────────────────── */}
      <div className="mb-4">
        <Link
          href="/partners"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; All partners
        </Link>
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <BusinessIcon sx={{ fontSize: 22 }} className="text-purple-400" />
          <h2 className="text-lg font-semibold text-gray-100">{company}</h2>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${tierBadgeColor(baseTier)}`}
          >
            {baseTier}
          </span>
        </div>
        <div className="ml-[30px]">
          <p className="text-sm text-gray-400">{ownerEmail}</p>
          {ownerName && <p className="text-xs text-gray-600 mt-0.5">{ownerName}</p>}
        </div>
        <div className="ml-[30px] mt-2 text-xs text-gray-500">
          Monthly price:{" "}
          {baseMonthlyPrice > 0
            ? `€${baseMonthlyPrice.toFixed(2)}`
            : "— (free)"}
          <span className="mx-2">&middot;</span>
          Sites: {currentSiteCount} / {basePlanMaxSites ?? "∞"}
        </div>
      </div>

      <div className="border-t border-gray-800 mb-6" />

      {/* ── Effective subscription summary ─────────────────────── */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Effective Subscription</h3>
        <div className="border border-gray-800 rounded-lg bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Max sites</div>
              <div className="text-2xl font-bold text-gray-100">
                {effectiveMaxSites}
                {isCustomMaxSites && (
                  <span className="ml-2 text-xs font-normal text-amber-400">(custom)</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 mb-6" />

      {/* ── Custom subscription panel ───────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Custom Subscription Override</h3>
        <p className="text-xs text-gray-500 mb-4">
          Override the base plan&rsquo;s site limit for this partner. Leave blank to inherit from
          the base plan.
        </p>

        {maxSitesErrors.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
            {maxSitesErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-400">{e}</p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <TextField
            label="Max sites (custom)"
            size="small"
            type="number"
            value={maxSitesInput}
            onChange={(e) => setMaxSitesInput(e.target.value)}
            placeholder={basePlanMaxSites != null ? String(basePlanMaxSites) : "base plan value"}
            inputProps={{ min: 0, step: 1 }}
            sx={{ width: 180 }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleSaveMaxSites}
            disabled={maxSitesSaving || maxSitesClearing}
            sx={{ textTransform: "none" }}
          >
            {maxSitesSaving ? (
              <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving&hellip;</>
            ) : (
              "Save"
            )}
          </Button>
          {hasCustomSubscription && (
            <Button
              size="small"
              onClick={handleClearMaxSites}
              disabled={maxSitesSaving || maxSitesClearing}
              color="inherit"
              sx={{ textTransform: "none", color: "#9ca3af" }}
            >
              {maxSitesClearing ? (
                <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Resetting&hellip;</>
              ) : (
                "Reset to base"
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-gray-800 mb-6" />

      {/* ── Commission overrides ────────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Commission Overrides</h3>
        <p className="text-xs text-gray-500 mb-4">
          Account-level service fee overrides (highest priority in the three-tier cascade:
          site &rarr; account &rarr; platform). A 0% override completely waives the commission.
        </p>

        {waiveErrors.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
            {waiveErrors.map((e, i) => (
              <p key={i} className="text-xs text-red-400">{e}</p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-400">
            {accountFees.length} override{accountFees.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              variant="outlined"
              color="warning"
              onClick={handleWaiveAll}
              disabled={waiving || feeSaving}
              sx={{ textTransform: "none", fontSize: "0.75rem", borderColor: "#d97706", color: "#d97706" }}
            >
              {waiving ? (
                <><CircularProgress size={12} color="inherit" sx={{ mr: 0.5 }} /> Waiving&hellip;</>
              ) : (
                "Set commission to 0% (waive all service codes)"
              )}
            </Button>
            {!feeEditing && (
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => {
                  setFeeForm(makeNewForm())
                  setFeeErrors([])
                  setFeeEditing(true)
                }}
                sx={{ textTransform: "none", fontSize: "0.8rem" }}
              >
                Add override
              </Button>
            )}
          </div>
        </div>

        {accountFees.length === 0 && !feeEditing && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <PercentIcon sx={{ fontSize: 40, mb: 1, color: "#6b7280" }} />
            <p className="text-xs">No account-level overrides. Platform defaults apply.</p>
          </div>
        )}

        {accountFees.map((fee) => (
          <FeeCard
            key={fee.id}
            fee={fee}
            onEdit={() => {
              setFeeForm(makeEditForm(fee))
              setFeeErrors([])
              setFeeEditing(true)
            }}
            onDelete={() => setDeleteTarget(fee)}
          />
        ))}

        {feeEditing && (
          <FeeForm
            form={feeForm}
            setForm={setFeeForm}
            settings={settings}
            serviceCodes={serviceCodes}
            saving={feeSaving}
            errors={feeErrors}
            onSave={handleFeeSave}
            onCancel={() => setFeeEditing(false)}
          />
        )}
      </div>

      <div className="border-t border-gray-800 mb-6" />

      {/* ── Feature overrides ───────────────────────────────────── */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Features</h3>
        <p className="text-xs text-gray-500 mb-4">
          Per-feature entitlement overrides. <strong>Inherit</strong> follows the tier default;
          <strong> Force on</strong> / <strong>Force off</strong> override it regardless of tier.
        </p>

        {featureRows.length === 0 && (
          <p className="text-xs text-gray-500">No features defined in catalog.</p>
        )}

        {featureRows.map((row) => {
          const saving = featureSaving[row.key] ?? false
          const errors = featureErrors[row.key] ?? []
          // tri-state: null = inherit, true = force on, false = force off
          const currentSelection: "inherit" | "on" | "off" =
            row.override === null ? "inherit" : row.override ? "on" : "off"

          return (
            <div
              key={row.key}
              className="border border-gray-800 rounded-lg bg-gray-900 p-4 mb-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-200">{row.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{row.description}</div>
                  <div className="text-xs mt-1">
                    <span className="text-gray-600">Effective: </span>
                    <span
                      className={
                        row.effectiveValue ? "text-green-400" : "text-gray-500"
                      }
                    >
                      {row.effectiveValue ? "On" : "Off"}
                    </span>
                    <span className="text-gray-700 mx-1">&middot;</span>
                    {row.override !== null ? (
                      <span className="text-amber-400">override</span>
                    ) : (
                      <span className="text-gray-600">
                        tier default: {row.tierDefault ? "on" : "off"}
                      </span>
                    )}
                  </div>
                  {errors.length > 0 && (
                    <div className="mt-1">
                      {errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-400">{e}</p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tri-state segmented control */}
                <div className="flex items-center rounded-md overflow-hidden border border-gray-700 shrink-0">
                  {(
                    [
                      { value: "inherit", label: "Inherit" },
                      { value: "on", label: "Force on" },
                      { value: "off", label: "Force off" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => {
                        if (saving || value === currentSelection) return
                        const next: boolean | null =
                          value === "inherit" ? null : value === "on" ? true : false
                        handleFeatureOverride(row.key, next)
                      }}
                      disabled={saving || value === currentSelection}
                      className={[
                        "px-2.5 py-1.5 text-xs font-medium transition-colors",
                        "border-r border-gray-700 last:border-r-0",
                        value === currentSelection
                          ? "bg-purple-600/40 text-purple-200 cursor-default"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200",
                        saving ? "opacity-50 cursor-not-allowed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {saving && value === currentSelection ? (
                        <CircularProgress size={10} color="inherit" />
                      ) : (
                        label
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Delete fee confirmation dialog ──────────────────────── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete commission override?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove the <strong>{deleteTarget?.serviceCode}</strong> fee override
            ({deleteTarget?.chargeType})? The platform default fee will apply again.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleFeeDelete}
            disabled={deleting}
            sx={{ textTransform: "none" }}
          >
            {deleting ? (
              <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Deleting&hellip;</>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
