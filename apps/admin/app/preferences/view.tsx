'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { PreferenceAdminRow } from '@repo/data/preferences'
import {
  DEVICE_POWER_MODES,
  describePollBand,
  devicePowerModeLabel,
  isDevicePowerMode,
  pollBandFor,
  validatePollInterval,
  type DevicePowerMode,
} from '@repo/data/device-power'
import {
  savePreference,
  resetPreference,
  saveDevicePolicy,
  resetDevicePolicy,
  listPreferences,
} from './actions'

/**
 * The two registry keys this page renders as ONE card instead of two rows.
 *
 * Spelled out here as literals on purpose: `@repo/data/preferences` imports Prisma
 * and cannot be pulled into a client bundle. If a key is ever renamed the pair
 * simply stops matching and both fall back to generic rows — visibly worse, never
 * wrong, and the coupling itself is enforced server-side in `setDevicePolicy`
 * either way.
 */
const MODE_KEY = 'device-power-mode'
const POLL_KEY = 'device-poll-interval-sec'

function SourceBadge({ source }: { source: PreferenceAdminRow['source'] }) {
  const styles: Record<PreferenceAdminRow['source'], string> = {
    env: 'bg-amber-500/20 text-amber-300',
    db: 'bg-green-500/20 text-green-300',
    default: 'bg-gray-500/20 text-gray-300',
  }
  const label: Record<PreferenceAdminRow['source'], string> = {
    env: 'env var',
    db: 'database',
    default: 'built-in default',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[source]}`}
    >
      {label[source]}
    </span>
  )
}

function EnvOverrideNote({ row }: { row: PreferenceAdminRow }) {
  if (row.envValue === null) return null
  return (
    <p className="text-xs text-amber-400 mt-1">
      An environment variable override is set ({row.envValue}) — values saved here are
      recorded but won&apos;t take effect until the env var is removed.
    </p>
  )
}

function LastChange({ row }: { row: PreferenceAdminRow }) {
  if (!row.updatedAt) return null
  return (
    <p className="text-xs text-gray-500 mt-1">
      last change: {new Date(row.updatedAt).toLocaleString()}{' '}
      {row.updatedBy ? `(by ${row.updatedBy})` : ''}
    </p>
  )
}

/**
 * The device power policy — the power mode and the poll interval that has to fit
 * inside it, in ONE card with the interval nested under the mode.
 *
 * They are not two settings that happen to share a group: the mode decides which
 * cadences physically exist, so the interval is only meaningful relative to it
 * (track 025). Rendering them as sibling rows with a Save button each invited
 * exactly the sequence the server then has to deal with — set the mode, watch the
 * interval be re-fitted underneath without anyone choosing the new number. Here the
 * pair is edited and saved together, validated in the browser against the mode
 * currently selected IN THE FORM, so changing the mode immediately invalidates an
 * interval the new mode cannot keep and blocks the save before it is attempted. The
 * same check runs again in `setDevicePolicy`, which is what actually holds.
 */
function DevicePolicyCard({
  modeRow,
  intervalRow,
  onResync,
}: {
  modeRow: PreferenceAdminRow
  intervalRow: PreferenceAdminRow
  onResync: () => void
}) {
  const storedMode = String(modeRow.dbValue ?? modeRow.resolved)
  const storedInterval = String(intervalRow.dbValue ?? intervalRow.resolved)

  const [mode, setMode] = useState(storedMode)
  const [seconds, setSeconds] = useState(storedInterval)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  // The parent re-reads every row after a write, because a write can move a value
  // the admin did not type. Pick that up rather than keeping a draft that no longer
  // matches what is stored.
  useEffect(() => {
    setMode(storedMode)
    setSeconds(storedInterval)
  }, [storedMode, storedInterval])

  const draftMode: DevicePowerMode | null = isDevicePowerMode(mode) ? mode : null
  const check = useMemo(
    () =>
      draftMode
        ? validatePollInterval(draftMode, seconds)
        : ({ ok: false, error: 'Pick a power mode' } as const),
    [draftMode, seconds],
  )
  const invalid = check.ok ? null : check.error

  /**
   * Which other modes could keep this cadence. The admin is one click away from a
   * legal pair and shouldn't have to read the bands out of the description to find
   * which one — the overlap between bands is where the judgement calls live.
   */
  const alternatives = useMemo(() => {
    if (check.ok) return []
    return DEVICE_POWER_MODES.filter(
      (m) => m !== draftMode && validatePollInterval(m, seconds).ok,
    )
  }, [check.ok, draftMode, seconds])

  const dirty = mode !== storedMode || seconds.trim() !== storedInterval.trim()
  const band = draftMode ? pollBandFor(draftMode) : null
  const hasOverride = modeRow.dbValue !== null || intervalRow.dbValue !== null
  const servedMode = isDevicePowerMode(modeRow.resolved) ? modeRow.resolved : null

  const handleSave = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveDevicePolicy(mode, seconds.trim())
      if (result.status !== 'ok') {
        setError(result.errors?.[0] ?? 'Failed to save')
        return
      }
      setSaved(true)
      onResync()
    })
  }

  const handleReset = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await resetDevicePolicy()
      } catch {
        setError('Failed to reset')
        return
      }
      onResync()
    })
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      {/* The envelope — what the fleet is actually being served right now. */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-100">Device power policy</span>
          <span className="text-xs font-medium text-green-400">
            {servedMode ? devicePowerModeLabel(servedMode) : String(modeRow.resolved)} ·{' '}
            {String(intervalRow.resolved)} s
          </span>
        </div>
        <p className="text-sm text-gray-400 mt-1">
          One setting in two parts, served together on every 200 from{' '}
          <code className="text-purple-300">/api/hw/&#123;code&#125;/state</code> as{' '}
          <code className="text-purple-300">powerMode</code> +{' '}
          <code className="text-purple-300">pollAfterSec</code>. The mode decides which
          cadences physically exist; the interval picks one inside that band. They are
          saved as a pair, because a mode change can invalidate the cadence beneath it.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Level 1 — the mode. */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="device-power-mode-input"
                className="flex items-center gap-2 flex-wrap"
              >
                <span className="text-sm font-semibold text-gray-100">{modeRow.label}</span>
                <code className="text-xs text-purple-300">{modeRow.key}</code>
                <SourceBadge source={modeRow.source} />
              </label>
              <p className="text-sm text-gray-400 mt-1">{modeRow.description}</p>
            </div>
            <select
              id="device-power-mode-input"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value)
                setSaved(false)
                setError(null)
              }}
              className="w-40 flex-shrink-0 px-2 py-1.5 rounded bg-gray-950 border border-gray-700 text-sm text-gray-200"
            >
              {(modeRow.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <EnvOverrideNote row={modeRow} />
          <LastChange row={modeRow} />
        </div>

        {/* Level 2 — the cadence, nested under the mode that bounds it. */}
        <div className="ml-1 pl-4 border-l-2 border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="device-poll-interval-input"
                className="flex items-center gap-2 flex-wrap"
              >
                <span className="text-sm font-semibold text-gray-100">
                  {intervalRow.label}
                </span>
                <code className="text-xs text-purple-300">{intervalRow.key}</code>
                <SourceBadge source={intervalRow.source} />
              </label>
              <p className="text-sm text-gray-400 mt-1">{intervalRow.description}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <input
                id="device-poll-interval-input"
                type="number"
                inputMode="numeric"
                value={seconds}
                min={band?.min}
                max={band?.max}
                step={1}
                aria-invalid={invalid !== null}
                aria-describedby={
                  invalid ? 'device-poll-interval-error' : 'device-poll-interval-hint'
                }
                onChange={(e) => {
                  setSeconds(e.target.value)
                  setSaved(false)
                  setError(null)
                }}
                className={`w-24 px-2 py-1.5 rounded bg-gray-950 border text-sm text-gray-200 ${
                  invalid ? 'border-red-600' : 'border-gray-700'
                }`}
              />
              <span className="text-xs text-gray-400">seconds</span>
            </div>
          </div>

          {/* The band hint is the resting state; when the pair is illegal the error
              replaces it, since it says the same thing plus the verdict. */}
          {invalid ? (
            <p
              id="device-poll-interval-error"
              role="alert"
              className="text-xs text-red-400 mt-2"
            >
              {invalid}
              {alternatives.length > 0 && (
                <> {alternatives.map(devicePowerModeLabel).join(' and ')} can keep it.</>
              )}
            </p>
          ) : (
            <p id="device-poll-interval-hint" className="text-xs text-gray-500 mt-2">
              {draftMode ? (
                <>
                  <span className="text-gray-300">{devicePowerModeLabel(draftMode)}</span>{' '}
                  accepts <span className="text-gray-300">{describePollBand(draftMode)}</span>.
                </>
              ) : (
                'Pick a power mode to see the cadences it can keep.'
              )}
            </p>
          )}
          <EnvOverrideNote row={intervalRow} />
          <LastChange row={intervalRow} />
        </div>

        {/* One footer for the envelope — the pair is saved and reset together. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
          <div className="text-xs text-gray-500">
            default:{' '}
            <span className="text-gray-300">
              {isDevicePowerMode(modeRow.default)
                ? devicePowerModeLabel(modeRow.default)
                : String(modeRow.default)}{' '}
              · {String(intervalRow.default)} s
            </span>
            {error && (
              <span role="alert" className="block text-red-400 mt-1">
                {error}
              </span>
            )}
            {saved && !error && <span className="block text-green-400 mt-1">Saved.</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || !dirty || invalid !== null}
              onClick={handleSave}
              title={invalid ?? undefined}
              className="px-3 py-1.5 rounded text-sm font-medium border border-green-700 text-green-300 hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save policy
            </button>
            <button
              type="button"
              disabled={pending || !hasOverride}
              onClick={handleReset}
              className="px-3 py-1.5 rounded text-sm font-medium border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Reset both
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreferenceRow({
  row,
  onSaved,
  onResync,
}: {
  row: PreferenceAdminRow
  onSaved: (key: string, patch: Partial<PreferenceAdminRow>) => void
  /**
   * Re-read every row from the server. Needed because preferences are not always
   * independent: a write can move a value the admin did not touch, so patching only
   * the row that was edited would leave a stale number on screen next to the change
   * that moved it.
   */
  onResync: () => void
}) {
  const [draft, setDraft] = useState(String(row.dbValue ?? row.resolved))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const dirty = draft.trim() !== String(row.dbValue ?? row.resolved).trim()

  const handleSave = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await savePreference(row.key, draft)
      if (result.status !== 'ok') {
        setError(result.errors?.[0] ?? 'Failed to save')
        return
      }
      setSaved(true)
      const parsed = row.type === 'number' ? Number(draft.trim()) : draft.trim()
      onSaved(row.key, {
        dbValue: String(draft).trim(),
        // An env var still wins — don't claim a value is live when it isn't.
        resolved: row.envValue !== null ? row.resolved : parsed,
        source: row.envValue !== null ? 'env' : 'db',
      })
      onResync()
    })
  }

  const handleReset = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await resetPreference(row.key)
      if (result.status !== 'ok') {
        setError(result.errors?.[0] ?? 'Failed to reset')
        return
      }
      setDraft(String(row.default))
      onSaved(row.key, {
        dbValue: null,
        resolved: row.envValue !== null ? row.resolved : row.default,
        source: row.envValue !== null ? 'env' : 'default',
      })
      onResync()
    })
  }

  return (
    <div className="p-4 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-100">{row.label}</span>
          <code className="text-xs text-purple-300">{row.key}</code>
          <SourceBadge source={row.source} />
          <span className="text-xs font-medium text-green-400">
            {String(row.resolved)}
            {row.unit ? ` ${row.unit}` : ''}
          </span>
        </div>
        <p className="text-sm text-gray-400 mt-1">{row.description}</p>
        <div className="mt-2 text-xs text-gray-500 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
          <span>
            default: <span className="text-gray-300">{String(row.default)}</span>
          </span>
          {row.type === 'number' && (
            <span>
              allowed:{' '}
              <span className="text-gray-300">
                {row.min}–{row.max}
                {row.unit ? ` ${row.unit}` : ''}
              </span>
            </span>
          )}
          {row.type === 'enum' && row.options && (
            <span>
              allowed:{' '}
              <span className="text-gray-300">
                {row.options.map((o) => o.value).join(' · ')}
              </span>
            </span>
          )}
          <span>
            env var:{' '}
            <span className="text-gray-300">{row.envValue === null ? '—' : row.envValue}</span>
          </span>
        </div>
        <LastChange row={row} />
        <EnvOverrideNote row={row} />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {saved && !error && <p className="text-xs text-green-400 mt-1">Saved.</p>}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {row.type === 'enum' && row.options ? (
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-36 px-2 py-1.5 rounded bg-gray-950 border border-gray-700 text-sm text-gray-200"
          >
            {row.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : row.type === 'boolean' ? (
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-28 px-2 py-1.5 rounded bg-gray-950 border border-gray-700 text-sm text-gray-200"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            type={row.type === 'number' ? 'number' : 'text'}
            value={draft}
            min={row.min ?? undefined}
            max={row.max ?? undefined}
            maxLength={row.maxLength ?? undefined}
            onChange={(e) => setDraft(e.target.value)}
            className="w-28 px-2 py-1.5 rounded bg-gray-950 border border-gray-700 text-sm text-gray-200"
          />
        )}
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={handleSave}
          className="px-3 py-1.5 rounded text-sm font-medium border border-green-700 text-green-300 hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <button
          type="button"
          disabled={pending || row.dbValue === null}
          onClick={handleReset}
          className="px-3 py-1.5 rounded text-sm font-medium border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>
    </div>
  )
}

export default function PreferencesView({
  initialRows,
}: {
  initialRows: PreferenceAdminRow[]
}) {
  const [rows, setRows] = useState(initialRows)

  const patch = (key: string, p: Partial<PreferenceAdminRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }

  // A write can move a value the admin did not touch, so the whole set is re-read
  // after any save. The local patch above stays because it lands immediately; this
  // corrects it.
  const resync = () => {
    listPreferences()
      .then(setRows)
      .catch(() => {
        /* The optimistic patch stands; a reload will show the truth. */
      })
  }

  const groups = rows.reduce<Record<string, PreferenceAdminRow[]>>((acc, row) => {
    ;(acc[row.group] ??= []).push(row)
    return acc
  }, {})

  const modeRow = rows.find((r) => r.key === MODE_KEY)
  const intervalRow = rows.find((r) => r.key === POLL_KEY)
  const coupled = modeRow && intervalRow ? { modeRow, intervalRow } : null

  return (
    <div className="py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Preferences</h1>
        <p className="text-sm text-gray-400 mt-1">
          Platform-wide values that would otherwise be constants in a deployed
          source file. Resolution order:{' '}
          <span className="text-amber-300">env var</span> &rarr;{' '}
          <span className="text-green-300">database</span> &rarr;{' '}
          <span className="text-gray-300">built-in default</span>. A value outside
          the allowed range is refused here and ignored if it reaches the database
          another way.
        </p>
      </div>

      {Object.entries(groups).map(([group, groupRows]) => {
        // The coupled pair is one card at the top of its group; everything else
        // keeps the generic one-row-per-preference form.
        const showCoupled =
          coupled !== null && groupRows.some((r) => r.key === MODE_KEY || r.key === POLL_KEY)
        const plainRows = showCoupled
          ? groupRows.filter((r) => r.key !== MODE_KEY && r.key !== POLL_KEY)
          : groupRows

        return (
          <div key={group} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-300 mb-2">{group}</h2>
            {showCoupled && coupled && (
              <DevicePolicyCard
                modeRow={coupled.modeRow}
                intervalRow={coupled.intervalRow}
                onResync={resync}
              />
            )}
            {plainRows.length > 0 && (
              <div className="rounded-lg border border-gray-800 divide-y divide-gray-800 bg-gray-900/40">
                {plainRows.map((row) => (
                  <PreferenceRow key={row.key} row={row} onSaved={patch} onResync={resync} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
