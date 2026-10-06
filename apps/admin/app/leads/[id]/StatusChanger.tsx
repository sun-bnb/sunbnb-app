'use client'

import { useState, useTransition } from 'react'
import { updateLeadStatus } from '../actions'

const OPTIONS = ['demo_requested', 'contacted', 'converted', 'closed']

export default function StatusChanger({ id, current }: { id: string; current: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function change(status: string) {
    setError(null)
    start(async () => {
      const res = await updateLeadStatus(id, status)
      if (res.status === 'error') setError(res.errors?.[0] ?? 'Failed')
    })
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Change status"
        className="bg-gray-900 border border-gray-800 rounded-md px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
      >
        {!OPTIONS.includes(current) && <option value={current} disabled>{current.replace(/_/g, ' ')}</option>}
        {OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {error && (
        <span role="status" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </div>
  )
}
