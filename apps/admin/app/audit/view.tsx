'use client'

import { useCallback, useEffect, useState } from 'react'
import { listImpersonationAudit, type AuditPage, type AuditRow } from './actions'
import { AUDIT_PAGE_SIZE } from './constants'

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'active'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function AppBadge({ app }: { app: string }) {
  const styles =
    app === 'partner'
      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
      : app === 'user'
        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
        : 'bg-gray-700/30 text-gray-400 border-gray-700/50'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles}`}
    >
      {app}
    </span>
  )
}

interface Props {
  initial: AuditPage
  initialTargetUserId: string | null
}

export default function AuditView({ initial, initialTargetUserId }: Props) {
  const [data, setData] = useState<AuditPage>(initial)
  const [page, setPage] = useState(initial.page)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await listImpersonationAudit(p, {
        targetUserId: initialTargetUserId ?? undefined,
      })
      setData(res)
      setPage(res.page)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [initialTargetUserId])

  // Re-fetch when the page state changes (not on first render — `initial`
  // already covers page 1).
  useEffect(() => {
    if (page !== initial.page) load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1
  const to = Math.min(data.total, data.page * data.pageSize)

  return (
    <div className="py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Impersonation Audit</h1>
        <p className="text-sm text-gray-400 mt-1">
          Every admin impersonation session, newest first. Active rows (no end
          time) are currently in progress.
        </p>
        {initialTargetUserId && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-400 bg-gray-900/50 border border-gray-800 rounded px-2 py-1">
            <span>Filtered by target user:</span>
            <code className="text-purple-300">{initialTargetUserId}</code>
            <a
              href="/audit"
              className="text-gray-500 hover:text-gray-300 underline"
            >
              clear
            </a>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-800 overflow-hidden bg-gray-900/40">
        {data.logs.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {loading ? 'Loading…' : 'No impersonation activity'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Started</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Duration</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Admin</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Target</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">App</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((row: AuditRow) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-gray-300">
                      {new Date(row.startedAt).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.endedAt ? (
                      <span className="text-gray-400">
                        {formatDuration(row.durationSeconds)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-300">
                      {row.adminEmail ?? <code className="text-gray-600">{row.adminId}</code>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/audit?targetUserId=${row.targetUserId}`}
                      className="text-gray-300 hover:text-purple-300 underline-offset-2 hover:underline"
                      title={`Filter by ${row.targetEmail ?? row.targetUserId}`}
                    >
                      {row.targetEmail ?? row.targetUserId}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <AppBadge app={row.app} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                    {row.ip ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-900/30 text-xs text-gray-500">
            <span>
              {loading ? 'Loading…' : `${from}–${to} of ${data.total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-2.5 py-1 rounded text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="px-2 text-gray-400">
                Page {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-2.5 py-1 rounded text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600">
        Page size: {AUDIT_PAGE_SIZE}
      </p>
    </div>
  )
}
