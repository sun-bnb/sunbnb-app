'use client'

import { useState, useTransition } from 'react'
import type { FlagAdminRow } from '@repo/data/flags'
import { setFlag, clearFlag } from './actions'

function SourceBadge({ source }: { source: FlagAdminRow['source'] }) {
  const styles: Record<FlagAdminRow['source'], string> = {
    sudo: 'bg-purple-500/20 text-purple-300',
    env: 'bg-amber-500/20 text-amber-300',
    account: 'bg-blue-500/20 text-blue-300',
    db: 'bg-green-500/20 text-green-300',
    default: 'bg-gray-500/20 text-gray-300',
  }
  const label: Record<FlagAdminRow['source'], string> = {
    sudo: 'sudo override',
    env: 'env var',
    account: 'per customer',
    db: 'database',
    default: 'env default',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[source]}`}
    >
      {label[source]}
    </span>
  )
}

export default function FlagsView({
  initialRows,
}: {
  initialRows: FlagAdminRow[]
}) {
  const [rows, setRows] = useState(initialRows)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const update = (name: string, patch: Partial<FlagAdminRow>) => {
    setRows((prev) => prev.map((r) => (r.name === name ? { ...r, ...patch } : r)))
  }

  const handleToggle = (row: FlagAdminRow, enabled: boolean) => {
    setError(null)
    // Optimistic: assume the DB override wins. If env override is set, it will
    // still win; we re-fetch on next navigation.
    update(row.name, {
      dbOverride: enabled,
      resolved: row.envOverride === null ? enabled : row.envOverride,
      source: row.envOverride === null ? 'db' : 'env',
    })
    startTransition(async () => {
      const result = await setFlag(row.name, enabled)
      if (result.status !== 'ok') {
        setError(result.errors?.[0] ?? 'Failed to update flag')
      }
    })
  }

  const handleClear = (row: FlagAdminRow) => {
    setError(null)
    update(row.name, {
      dbOverride: null,
      resolved:
        row.envOverride !== null
          ? row.envOverride
          : row.defaults[row.currentEnvironment],
      source: row.envOverride !== null ? 'env' : 'default',
    })
    startTransition(async () => {
      const result = await clearFlag(row.name)
      if (result.status !== 'ok') {
        setError(result.errors?.[0] ?? 'Failed to clear flag')
      }
    })
  }

  return (
    <div className="py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Feature Flags</h1>
        <p className="text-sm text-gray-400 mt-1">
          Runtime overrides for feature gates. Resolution order:{' '}
          <span className="text-purple-300">sudo</span> &rarr;{' '}
          <span className="text-amber-300">env var</span> &rarr;{' '}
          <span className="text-green-300">database</span> &rarr;{' '}
          <span className="text-gray-300">env default</span>. Changes take effect
          immediately for new requests in this app; other apps catch up on next
          server render.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-800 divide-y divide-gray-800 bg-gray-900/40">
        {rows.map((row) => (
          <div
            key={row.name}
            className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm font-semibold text-purple-300">
                  {row.name}
                </code>
                <SourceBadge source={row.source} />
                <span
                  className={`text-xs font-medium ${
                    row.resolved ? 'text-green-400' : 'text-gray-500'
                  }`}
                >
                  {row.resolved ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-1">{row.description}</p>
              <div className="mt-2 text-xs text-gray-500 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                <span>
                  env: <span className="text-gray-300">{row.currentEnvironment}</span>
                </span>
                <span>
                  default:{' '}
                  <span className="text-gray-300">
                    {String(row.defaults[row.currentEnvironment])}
                  </span>
                </span>
                <span>
                  env var:{' '}
                  <span className="text-gray-300">
                    {row.envOverride === null ? '—' : String(row.envOverride)}
                  </span>
                </span>
                <span>
                  db row:{' '}
                  <span className="text-gray-300">
                    {row.dbOverride === null ? '—' : String(row.dbOverride)}
                  </span>
                </span>
              </div>
              {row.updatedAt && (
                <p className="text-xs text-gray-500 mt-1">
                  last DB change: {new Date(row.updatedAt).toLocaleString()}{' '}
                  {row.updatedBy ? `(by ${row.updatedBy})` : ''}
                </p>
              )}
              {row.envOverride !== null && (
                <p className="text-xs text-amber-400 mt-1">
                  An environment variable override is set — DB toggles below are
                  recorded but won&apos;t take effect until the env var is
                  removed.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                disabled={pending || row.dbOverride === true}
                onClick={() => handleToggle(row, true)}
                className="px-3 py-1.5 rounded text-sm font-medium border border-green-700 text-green-300 hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                On
              </button>
              <button
                type="button"
                disabled={pending || row.dbOverride === false}
                onClick={() => handleToggle(row, false)}
                className="px-3 py-1.5 rounded text-sm font-medium border border-red-700 text-red-300 hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Off
              </button>
              <button
                type="button"
                disabled={pending || row.dbOverride === null}
                onClick={() => handleClear(row)}
                className="px-3 py-1.5 rounded text-sm font-medium border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
