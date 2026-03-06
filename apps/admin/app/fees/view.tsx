"use client"

import { useState, useRef, useCallback } from "react"
import TextField from "@mui/material/TextField"
import Autocomplete from "@mui/material/Autocomplete"
import MenuItem from "@mui/material/MenuItem"
import Button from "@mui/material/Button"
import IconButton from "@mui/material/IconButton"
import Dialog from "@mui/material/Dialog"
import DialogTitle from "@mui/material/DialogTitle"
import DialogContent from "@mui/material/DialogContent"
import DialogContentText from "@mui/material/DialogContentText"
import DialogActions from "@mui/material/DialogActions"
import CircularProgress from "@mui/material/CircularProgress"
import Tabs from "@mui/material/Tabs"
import Tab from "@mui/material/Tab"
import AddIcon from "@mui/icons-material/Add"
import EditIcon from "@mui/icons-material/Edit"
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline"
import PercentIcon from "@mui/icons-material/Percent"
import AttachMoneyIcon from "@mui/icons-material/AttachMoney"
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong"
import LanguageIcon from "@mui/icons-material/Language"
import LocationOnIcon from "@mui/icons-material/LocationOn"
import BusinessIcon from "@mui/icons-material/Business"
import LabelIcon from "@mui/icons-material/Label"

import {
  saveServiceFee,
  deleteServiceFee,
  saveServiceCode,
  deleteServiceCode,
  searchSites,
  searchAccounts,
  getFeesBySite,
  getFeesByAccount,
  getPlatformFees,
  type FeeWithRelations,
} from "./actions"

// Types

interface Settings {
  id: string
  country: string | null
  vat: number | null
  currency: string | null
}

type ServiceCode = { id: string; code: string; description: string | null }
type SiteOption = { id: string; name: string }
type AccountOption = { userId: string; company: string; firstName: string; lastName: string }

type FormData = {
  id?: string
  settingsId: string
  chargeType: string
  feeAmount: string
  percentage: string
  serviceCode: string
  subscriptionTier: string
}

const emptyForm: FormData = {
  settingsId: "",
  chargeType: "percentage",
  feeAmount: "",
  percentage: "",
  serviceCode: "",
  subscriptionTier: "",
}

const tierTabs = [
  { value: "", label: "Default" },
  { value: "STARTER", label: "Starter" },
  { value: "PRO", label: "Pro" },
  { value: "BUSINESS", label: "Business" },
]

const chargeTypes = [
  { value: "percentage", label: "Percentage" },
  { value: "fixed", label: "Fixed amount" },
]

// Reusable fee card

function FeeCard({
  fee,
  settingsLabel,
  onEdit,
  onDelete,
}: {
  fee: FeeWithRelations
  settingsLabel: (s: Settings) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const parts: string[] = []
  if (fee.feeAmount != null) parts.push(`${fee.feeAmount} ${fee.settings.currency ?? ""}`.trim())
  if (fee.percentage != null) parts.push(`${fee.percentage}%`)
  const display = parts.join(" + ") || "\u2014"

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

// Reusable fee form

function FeeForm({
  form,
  setForm,
  settings,
  settingsLabel,
  serviceCodes,
  saving,
  errors,
  onSave,
  onCancel,
}: {
  form: FormData
  setForm: (f: FormData) => void
  settings: Settings[]
  settingsLabel: (s: Settings) => string
  serviceCodes: ServiceCode[]
  saving: boolean
  errors: string[]
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">
        {form.id ? "Edit Service Fee" : "New Service Fee"}
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
            placeholder="e.g. 15"
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
            <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving\u2026</>
          ) : (
            form.id ? "Save changes" : "Create fee"
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

// Main view

export default function FeesView({
  initialPlatformFees,
  settings,
  serviceCodes: initialServiceCodes,
}: {
  initialPlatformFees: FeeWithRelations[]
  settings: Settings[]
  serviceCodes: ServiceCode[]
}) {
  const settingsLabel = (s: Settings) =>
    [s.country, s.currency].filter(Boolean).join(" \u00b7 ") || s.id.slice(0, 8)

  // Platform fees state
  const [platformFees, setPlatformFees] = useState<FeeWithRelations[]>(initialPlatformFees)
  const [platformTierTab, setPlatformTierTab] = useState(0)
  const selectedTier = tierTabs[platformTierTab]?.value ?? ""
  const filteredPlatformFees = platformFees.filter(
    (f) => (f.subscriptionTier ?? "") === selectedTier
  )
  const [platformEditing, setPlatformEditing] = useState(false)
  const [platformForm, setPlatformForm] = useState<FormData>(emptyForm)
  const [platformSaving, setPlatformSaving] = useState(false)
  const [platformErrors, setPlatformErrors] = useState<string[]>([])

  // Site fees state
  const [selectedSite, setSelectedSite] = useState<SiteOption | null>(null)
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])
  const [siteLoading, setSiteLoading] = useState(false)
  const [siteFees, setSiteFees] = useState<FeeWithRelations[]>([])
  const [siteFeesLoading, setSiteFeesLoading] = useState(false)
  const [siteEditing, setSiteEditing] = useState(false)
  const [siteForm, setSiteForm] = useState<FormData>(emptyForm)
  const [siteSaving, setSiteSaving] = useState(false)
  const [siteErrors, setSiteErrors] = useState<string[]>([])
  const siteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Account fees state
  const [selectedAccount, setSelectedAccount] = useState<AccountOption | null>(null)
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([])
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountFees, setAccountFees] = useState<FeeWithRelations[]>([])
  const [accountFeesLoading, setAccountFeesLoading] = useState(false)
  const [accountEditing, setAccountEditing] = useState(false)
  const [accountForm, setAccountForm] = useState<FormData>(emptyForm)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountErrors, setAccountErrors] = useState<string[]>([])
  const accountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Delete state (shared)
  const [deleteTarget, setDeleteTarget] = useState<FeeWithRelations | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteContext, setDeleteContext] = useState<"platform" | "site" | "account">("platform")

  // Service codes state
  const [serviceCodes, setServiceCodes] = useState<ServiceCode[]>(initialServiceCodes)
  const [codeEditing, setCodeEditing] = useState(false)
  const [codeForm, setCodeForm] = useState<{ id?: string; code: string; description: string }>({ code: "", description: "" })
  const [codeSaving, setCodeSaving] = useState(false)
  const [codeErrors, setCodeErrors] = useState<string[]>([])
  const [codeDeleteTarget, setCodeDeleteTarget] = useState<ServiceCode | null>(null)
  const [codeDeleting, setCodeDeleting] = useState(false)

  // Search handlers

  const handleSiteSearch = useCallback((query: string) => {
    if (siteTimer.current) clearTimeout(siteTimer.current)
    if (!query.trim()) { setSiteOptions([]); return }
    setSiteLoading(true)
    siteTimer.current = setTimeout(async () => {
      const results = await searchSites(query)
      setSiteOptions(results)
      setSiteLoading(false)
    }, 300)
  }, [])

  const handleAccountSearch = useCallback((query: string) => {
    if (accountTimer.current) clearTimeout(accountTimer.current)
    if (!query.trim()) { setAccountOptions([]); return }
    setAccountLoading(true)
    accountTimer.current = setTimeout(async () => {
      const results = await searchAccounts(query)
      setAccountOptions(results)
      setAccountLoading(false)
    }, 300)
  }, [])

  const handleSelectSite = async (site: SiteOption | null) => {
    setSelectedSite(site)
    setSiteEditing(false)
    setSiteFees([])
    if (site) {
      setSiteFeesLoading(true)
      const fees = await getFeesBySite(site.id)
      setSiteFees(fees)
      setSiteFeesLoading(false)
    }
  }

  const handleSelectAccount = async (account: AccountOption | null) => {
    setSelectedAccount(account)
    setAccountEditing(false)
    setAccountFees([])
    if (account) {
      setAccountFeesLoading(true)
      const fees = await getFeesByAccount(account.userId)
      setAccountFees(fees)
      setAccountFeesLoading(false)
    }
  }

  // Save / delete helpers

  const saveFee = async (
    form: FormData,
    scope: { siteId?: string | null; accountId?: string | null },
    setSaving: (v: boolean) => void,
    setErrors: (e: string[]) => void,
    onSuccess: () => void,
  ) => {
    setSaving(true)
    setErrors([])
    const result = await saveServiceFee({
      id: form.id,
      settingsId: form.settingsId,
      siteId: scope.siteId ?? null,
      accountId: scope.accountId ?? null,
      subscriptionTier: form.subscriptionTier || null,
      chargeType: form.chargeType,
      feeAmount: form.feeAmount ? parseFloat(form.feeAmount) : null,
      percentage: form.percentage ? parseFloat(form.percentage) : null,
      serviceCode: form.serviceCode,
    })
    setSaving(false)
    if (result.status === "ok") {
      onSuccess()
    } else {
      setErrors(result.errors ?? ["Unknown error"])
    }
  }

  const handlePlatformSave = () =>
    saveFee(platformForm, {}, setPlatformSaving, setPlatformErrors, async () => {
      setPlatformEditing(false)
      setPlatformFees(await getPlatformFees())
    })

  const handleSiteSave = () =>
    saveFee(siteForm, { siteId: selectedSite?.id }, setSiteSaving, setSiteErrors, async () => {
      setSiteEditing(false)
      if (selectedSite) {
        setSiteFeesLoading(true)
        setSiteFees(await getFeesBySite(selectedSite.id))
        setSiteFeesLoading(false)
      }
    })

  const handleAccountSave = () =>
    saveFee(accountForm, { accountId: selectedAccount?.userId }, setAccountSaving, setAccountErrors, async () => {
      setAccountEditing(false)
      if (selectedAccount) {
        setAccountFeesLoading(true)
        setAccountFees(await getFeesByAccount(selectedAccount.userId))
        setAccountFeesLoading(false)
      }
    })

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await deleteServiceFee(deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (deleteContext === "platform") {
      setPlatformFees(await getPlatformFees())
    } else if (deleteContext === "site" && selectedSite) {
      setSiteFees(await getFeesBySite(selectedSite.id))
    } else if (deleteContext === "account" && selectedAccount) {
      setAccountFees(await getFeesByAccount(selectedAccount.userId))
    }
  }

  const openDelete = (fee: FeeWithRelations, ctx: "platform" | "site" | "account") => {
    setDeleteTarget(fee)
    setDeleteContext(ctx)
  }

  const makeNewForm = (tier?: string): FormData => ({
    ...emptyForm,
    settingsId: settings[0]?.id ?? "",
    subscriptionTier: tier ?? "",
  })

  const makeEditForm = (fee: FeeWithRelations): FormData => ({
    id: fee.id,
    settingsId: fee.settingsId,
    chargeType: fee.chargeType,
    feeAmount: fee.feeAmount?.toString() ?? "",
    percentage: fee.percentage?.toString() ?? "",
    serviceCode: fee.serviceCode,
    subscriptionTier: fee.subscriptionTier ?? "",
  })

  // Service code handlers

  const handleCodeSave = async () => {
    setCodeSaving(true)
    setCodeErrors([])
    const result = await saveServiceCode({
      id: codeForm.id,
      code: codeForm.code,
      description: codeForm.description || undefined,
    })
    setCodeSaving(false)
    if (result.status === "ok") {
      setCodeEditing(false)
      // Refresh service codes list
      const updated = codeForm.id
        ? serviceCodes.map((sc) =>
            sc.id === codeForm.id
              ? { ...sc, code: codeForm.code.toLowerCase(), description: codeForm.description || null }
              : sc,
          )
        : [...serviceCodes, { id: result.id!, code: codeForm.code.toLowerCase(), description: codeForm.description || null }]
      setServiceCodes(updated.sort((a, b) => a.code.localeCompare(b.code)))
    } else {
      setCodeErrors(result.errors ?? ["Unknown error"])
    }
  }

  const handleCodeDelete = async () => {
    if (!codeDeleteTarget) return
    setCodeDeleting(true)
    await deleteServiceCode(codeDeleteTarget.id)
    setCodeDeleting(false)
    setServiceCodes((prev) => prev.filter((sc) => sc.id !== codeDeleteTarget.id))
    setCodeDeleteTarget(null)
  }

  // Render

  return (
    <div className="p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Service Fees</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage platform-wide, site-specific, and account-specific service fees.
        </p>
      </div>

      {/* Section 0: Service Codes */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <LabelIcon sx={{ fontSize: 18 }} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Service Codes</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          Manage the available service codes used by fee rules.
        </p>

        <div className="flex items-center justify-between mb-3">
          <span />
          {!codeEditing && (
            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() => {
                setCodeForm({ code: "", description: "" })
                setCodeErrors([])
                setCodeEditing(true)
              }}
              sx={{ textTransform: "none", fontSize: "0.8rem" }}
            >
              Add service code
            </Button>
          )}
        </div>

        {serviceCodes.length === 0 && !codeEditing && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <LabelIcon sx={{ fontSize: 40, mb: 1, color: "#6b7280" }} />
            <p className="text-xs">No service codes defined</p>
          </div>
        )}

        {serviceCodes.map((sc) => (
          <div
            key={sc.id}
            className="border border-gray-800 rounded-lg bg-gray-900 p-4 mb-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-400/10 text-purple-400">
                    <LabelIcon sx={{ fontSize: 16 }} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-200">{sc.code}</div>
                    {sc.description && (
                      <div className="text-xs text-gray-500">{sc.description}</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  size="small"
                  onClick={() => {
                    setCodeForm({ id: sc.id, code: sc.code, description: sc.description ?? "" })
                    setCodeErrors([])
                    setCodeEditing(true)
                  }}
                >
                  <EditIcon fontSize="small" className="text-gray-400" />
                </IconButton>
                <IconButton size="small" onClick={() => setCodeDeleteTarget(sc)}>
                  <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                </IconButton>
              </div>
            </div>
          </div>
        ))}

        {codeEditing && (
          <div className="border border-purple-500/30 rounded-lg bg-purple-400/5 p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">
              {codeForm.id ? "Edit Service Code" : "New Service Code"}
            </h3>

            {codeErrors.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mb-3">
                {codeErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400">{e}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <TextField
                label="Code"
                size="small"
                value={codeForm.code}
                onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value })}
                placeholder="e.g. PLATFORM_FEE"
                inputProps={{ style: { textTransform: "lowercase" } }}
              />
              <TextField
                label="Description"
                size="small"
                value={codeForm.description}
                onChange={(e) => setCodeForm({ ...codeForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="contained"
                size="small"
                onClick={handleCodeSave}
                disabled={codeSaving}
                sx={{ textTransform: "none" }}
              >
                {codeSaving ? (
                  <><CircularProgress size={14} color="inherit" sx={{ mr: 0.5 }} /> Saving&hellip;</>
                ) : (
                  codeForm.id ? "Save changes" : "Create code"
                )}
              </Button>
              <Button
                size="small"
                onClick={() => setCodeEditing(false)}
                disabled={codeSaving}
                sx={{ textTransform: "none" }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 mb-8" />

      {/* Section 1: Platform Fees */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <LanguageIcon sx={{ fontSize: 18 }} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Platform Fees</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          Fees applied per subscription tier. &ldquo;Default&rdquo; applies when no tier-specific fee exists.
        </p>

        <Tabs
          value={platformTierTab}
          onChange={(_, v) => { setPlatformTierTab(v); setPlatformEditing(false) }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            mb: 2,
            minHeight: 32,
            "& .MuiTab-root": {
              textTransform: "none",
              minHeight: 32,
              py: 0.5,
              fontSize: "0.8rem",
            },
          }}
        >
          {tierTabs.map((t) => (
            <Tab key={t.value} label={t.label} />
          ))}
        </Tabs>

        <div className="flex items-center justify-between mb-3">
          <span />
          {!platformEditing && (
            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() => {
                setPlatformForm(makeNewForm(selectedTier))
                setPlatformErrors([])
                setPlatformEditing(true)
              }}
              sx={{ textTransform: "none", fontSize: "0.8rem" }}
            >
              Add platform fee
            </Button>
          )}
        </div>

        {filteredPlatformFees.length === 0 && !platformEditing && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <ReceiptLongIcon sx={{ fontSize: 40, mb: 1, color: "#6b7280" }} />
            <p className="text-xs">No fees configured for this tier</p>
          </div>
        )}

        {filteredPlatformFees.map((fee) => (
          <FeeCard
            key={fee.id}
            fee={fee}
            settingsLabel={settingsLabel}
            onEdit={() => {
              setPlatformForm(makeEditForm(fee))
              setPlatformErrors([])
              setPlatformEditing(true)
            }}
            onDelete={() => openDelete(fee, "platform")}
          />
        ))}

        {platformEditing && (
          <FeeForm
            form={platformForm}
            setForm={setPlatformForm}
            settings={settings}
            settingsLabel={settingsLabel}
            serviceCodes={serviceCodes}
            saving={platformSaving}
            errors={platformErrors}
            onSave={handlePlatformSave}
            onCancel={() => setPlatformEditing(false)}
          />
        )}
      </div>

      <div className="border-t border-gray-800 mb-8" />

      {/* Section 2: Site Fees */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <LocationOnIcon sx={{ fontSize: 18 }} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Site Fees</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          Search for a site to view and manage its fee overrides.
        </p>

        <Autocomplete
          size="small"
          options={siteOptions}
          getOptionLabel={(o) => `${o.name} (${o.id.slice(0, 8)}\u2026)`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          value={selectedSite}
          loading={siteLoading}
          onChange={(_, val) => handleSelectSite(val)}
          onInputChange={(_, val, reason) => {
            if (reason === "input") handleSiteSearch(val)
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search site"
              placeholder="Type site name or ID\u2026"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {siteLoading ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          noOptionsText="Type to search sites"
          sx={{ mb: 2 }}
        />

        {selectedSite && (
          <>
            {siteFeesLoading ? (
              <div className="flex justify-center py-6">
                <CircularProgress size={20} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-400">
                    {siteFees.length} fee{siteFees.length !== 1 ? "s" : ""} for{" "}
                    <strong className="text-gray-300">{selectedSite.name}</strong>
                  </span>
                  {!siteEditing && (
                    <Button
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => {
                        setSiteForm(makeNewForm())
                        setSiteErrors([])
                        setSiteEditing(true)
                      }}
                      sx={{ textTransform: "none", fontSize: "0.8rem" }}
                    >
                      Add site fee
                    </Button>
                  )}
                </div>

                {siteFees.length === 0 && !siteEditing && (
                  <div className="flex flex-col items-center justify-center py-6 text-gray-500">
                    <p className="text-xs">No fee overrides for this site. Platform defaults apply.</p>
                  </div>
                )}

                {siteFees.map((fee) => (
                  <FeeCard
                    key={fee.id}
                    fee={fee}
                    settingsLabel={settingsLabel}
                    onEdit={() => {
                      setSiteForm(makeEditForm(fee))
                      setSiteErrors([])
                      setSiteEditing(true)
                    }}
                    onDelete={() => openDelete(fee, "site")}
                  />
                ))}

                {siteEditing && (
                  <FeeForm
                    form={siteForm}
                    setForm={setSiteForm}
                    settings={settings}
                    settingsLabel={settingsLabel}
                    serviceCodes={serviceCodes}
                    saving={siteSaving}
                    errors={siteErrors}
                    onSave={handleSiteSave}
                    onCancel={() => setSiteEditing(false)}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="border-t border-gray-800 mb-8" />

      {/* Section 3: Account Fees */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <BusinessIcon sx={{ fontSize: 18 }} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Account Fees</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3 ml-[26px]">
          Search for a partner account to view and manage its fee overrides.
        </p>

        <Autocomplete
          size="small"
          options={accountOptions}
          getOptionLabel={(o) =>
            `${o.company}${o.firstName || o.lastName ? ` (${[o.firstName, o.lastName].filter(Boolean).join(" ")})` : ""}`
          }
          isOptionEqualToValue={(a, b) => a.userId === b.userId}
          value={selectedAccount}
          loading={accountLoading}
          onChange={(_, val) => handleSelectAccount(val)}
          onInputChange={(_, val, reason) => {
            if (reason === "input") handleAccountSearch(val)
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search account"
              placeholder="Type company name, partner name, or ID\u2026"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {accountLoading ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          noOptionsText="Type to search partners"
          sx={{ mb: 2 }}
        />

        {selectedAccount && (
          <>
            {accountFeesLoading ? (
              <div className="flex justify-center py-6">
                <CircularProgress size={20} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-400">
                    {accountFees.length} fee{accountFees.length !== 1 ? "s" : ""} for{" "}
                    <strong className="text-gray-300">{selectedAccount.company}</strong>
                  </span>
                  {!accountEditing && (
                    <Button
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => {
                        setAccountForm(makeNewForm())
                        setAccountErrors([])
                        setAccountEditing(true)
                      }}
                      sx={{ textTransform: "none", fontSize: "0.8rem" }}
                    >
                      Add account fee
                    </Button>
                  )}
                </div>

                {accountFees.length === 0 && !accountEditing && (
                  <div className="flex flex-col items-center justify-center py-6 text-gray-500">
                    <p className="text-xs">No fee overrides for this account. Platform defaults apply.</p>
                  </div>
                )}

                {accountFees.map((fee) => (
                  <FeeCard
                    key={fee.id}
                    fee={fee}
                    settingsLabel={settingsLabel}
                    onEdit={() => {
                      setAccountForm(makeEditForm(fee))
                      setAccountErrors([])
                      setAccountEditing(true)
                    }}
                    onDelete={() => openDelete(fee, "account")}
                  />
                ))}

                {accountEditing && (
                  <FeeForm
                    form={accountForm}
                    setForm={setAccountForm}
                    settings={settings}
                    settingsLabel={settingsLabel}
                    serviceCodes={serviceCodes}
                    saving={accountSaving}
                    errors={accountErrors}
                    onSave={handleAccountSave}
                    onCancel={() => setAccountEditing(false)}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Delete fee confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete service fee?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove the <strong>{deleteTarget?.serviceCode}</strong> fee rule
            ({deleteTarget?.chargeType})? This will not affect existing
            transactions that already applied this fee.
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
            onClick={handleDelete}
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

      {/* Delete service code confirmation */}
      <Dialog open={!!codeDeleteTarget} onClose={() => setCodeDeleteTarget(null)}>
        <DialogTitle>Delete service code?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove the <strong>{codeDeleteTarget?.code}</strong> service code?
            Existing fee rules using this code will not be affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setCodeDeleteTarget(null)}
            disabled={codeDeleting}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleCodeDelete}
            disabled={codeDeleting}
            sx={{ textTransform: "none" }}
          >
            {codeDeleting ? (
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
