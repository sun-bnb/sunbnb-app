'use client'

import { useState, useTransition } from 'react'
import type { PreferenceAdminRow } from '@repo/data/preferences'
import { savePreference, resetPreference } from './actions'

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

function PreferenceRow({
  row,
  onSaved,
}: {
  row: PreferenceAdminRow
  onSaved: (key: string, patch: Partial<PreferenceAdminRow>) => void
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
          <span>
            env var:{' '}
            <span className="text-gray-300">{row.envValue === null ? '—' : row.envValue}</span>
          </span>
        </div>
        {row.updatedAt && (
          <p className="text-xs text-gray-500 mt-1">
            last change: {new Date(row.updatedAt).toLocaleString()}{' '}
            {row.updatedBy ? `(by ${row.updatedBy})` : ''}
          </p>
        )}
        {row.envValue !== null && (
          <p className="text-xs text-amber-400 mt-1">
            An environment variable override is set — values saved here are recorded
            but won&apos;t take effect until the env var is removed.
          </p>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {saved && !error && <p className="text-xs text-green-400 mt-1">Saved.</p>}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {row.type === 'boolean' ? (
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

  const groups = rows.reduce<Record<string, PreferenceAdminRow[]>>((acc, row) => {
    ;(acc[row.group] ??= []).push(row)
    return acc
  }, {})

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

      {Object.entries(groups).map(([group, groupRows]) => (
        <div key={group}>
          <h2 className="text-sm font-semibold text-gray-300 mb-2">{group}</h2>
          <div className="rounded-lg border border-gray-800 divide-y divide-gray-800 bg-gray-900/40">
            {groupRows.map((row) => (
              <PreferenceRow key={row.key} row={row} onSaved={patch} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
