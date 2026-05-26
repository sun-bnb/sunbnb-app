'use client'

import { useState } from 'react'
import type { TableCombinationRecord } from '@repo/table-reservations-core'

const INPUT =
  'w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900'
const LABEL = 'block text-[11px] font-medium text-gray-500 mb-1'
const CARD = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm'
const HEADING = 'text-sm font-medium text-gray-700'

export interface CombinableTableInfo {
  id: string
  number: number
  label: string | null
  capacity: number
}

export interface CombinationsEditorLabels {
  heading: string
  addCombination: string
  emptyNoCombinations: string
  emptyNoTables: string
  name: string
  namePlaceholder: string
  capacity: string
  tablesHeading: string
  tablesNoneSelected: string
  tableLabel: string // e.g. "Table {n}" — used when label is null
  save: string
  saving: string
  cancel: string
  delete: string
  edit: string
  combinationCapacitySuggestion: string
  errorMinTables: string
}

export interface CombinationsEditorProps {
  combinations: TableCombinationRecord[]
  combinableTables: CombinableTableInfo[]
  labels: CombinationsEditorLabels
  onCreate: (input: {
    name?: string | null
    capacity: number
    tableIds: string[]
  }) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onUpdate: (
    id: string,
    patch: Partial<{ name?: string | null; capacity: number; tableIds: string[] }>,
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onDelete: (id: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

interface DraftState {
  mode: 'create' | 'edit'
  editingId?: string
  name: string
  capacity: string
  selectedTableIds: Set<string>
  saving: boolean
  errors: string[]
}

function tableDisplayLabel(t: CombinableTableInfo, tableLabel: string): string {
  const base = `${tableLabel.replace('{n}', String(t.number))}`
  return t.label ? `${base} (${t.label})` : base
}

function sumCapacity(ids: Set<string>, tables: CombinableTableInfo[]): number {
  let sum = 0
  for (const t of tables) {
    if (ids.has(t.id)) sum += t.capacity
  }
  return sum
}

/**
 * Editor for predefined table combinations (multiple tables joined for a large party).
 * Brand-neutral: all strings come via `labels`. Raw Tailwind utilities only — this
 * package cannot see the consuming app's accent token or .classes.
 */
export function CombinationsEditor({
  combinations,
  combinableTables,
  labels,
  onCreate,
  onUpdate,
  onDelete,
}: CombinationsEditorProps) {
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string[]>>({})

  // ── helpers ─────────────────────────────────────────────────────────────────

  function openCreate() {
    setDraft({
      mode: 'create',
      name: '',
      capacity: '',
      selectedTableIds: new Set(),
      saving: false,
      errors: [],
    })
  }

  function openEdit(combo: TableCombinationRecord) {
    setDraft({
      mode: 'edit',
      editingId: combo.id,
      name: combo.name ?? '',
      capacity: String(combo.capacity),
      selectedTableIds: new Set(combo.tableIds),
      saving: false,
      errors: [],
    })
  }

  function closeDraft() {
    setDraft(null)
  }

  function toggleTable(id: string) {
    if (!draft) return
    const next = new Set(draft.selectedTableIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    const suggested = sumCapacity(next, combinableTables)
    setDraft((d) =>
      d
        ? {
            ...d,
            selectedTableIds: next,
            // Auto-update capacity suggestion when capacity was previously auto-filled
            capacity:
              d.capacity === '' || d.capacity === String(sumCapacity(d.selectedTableIds, combinableTables))
                ? suggested > 0
                  ? String(suggested)
                  : ''
                : d.capacity,
          }
        : d,
    )
  }

  async function handleSave() {
    if (!draft) return
    if (draft.selectedTableIds.size < 2) {
      setDraft((d) => (d ? { ...d, errors: [labels.errorMinTables] } : d))
      return
    }
    const cap = parseInt(draft.capacity, 10)
    setDraft((d) => (d ? { ...d, saving: true, errors: [] } : d))

    const input = {
      name: draft.name.trim() || null,
      capacity: cap,
      tableIds: Array.from(draft.selectedTableIds),
    }

    let res: { status: 'ok' | 'error'; errors?: string[] }
    if (draft.mode === 'create') {
      res = await onCreate(input)
    } else {
      res = await onUpdate(draft.editingId!, input)
    }

    if (res.status === 'ok') {
      setDraft(null)
    } else {
      setDraft((d) => (d ? { ...d, saving: false, errors: res.errors ?? [] } : d))
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    setDeleteErrors((prev) => ({ ...prev, [id]: [] }))
    const res = await onDelete(id)
    setDeletingId(null)
    if (res.status !== 'ok') {
      setDeleteErrors((prev) => ({ ...prev, [id]: res.errors ?? [] }))
    }
  }

  // ── empty state — no combinable tables ──────────────────────────────────────

  if (combinableTables.length < 2) {
    return (
      <section className={CARD}>
        <h3 className={`${HEADING} mb-2`}>{labels.heading}</h3>
        <p className="text-xs text-gray-500">{labels.emptyNoTables}</p>
      </section>
    )
  }

  // ── main render ─────────────────────────────────────────────────────────────

  const canSave = draft !== null && draft.selectedTableIds.size >= 2 && draft.capacity !== '' && !draft.saving

  return (
    <section className={CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className={HEADING}>{labels.heading}</h3>
        {!draft && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            {labels.addCombination}
          </button>
        )}
      </div>

      {/* Existing combinations list */}
      {combinations.length === 0 && !draft ? (
        <p className="text-xs text-gray-500">{labels.emptyNoCombinations}</p>
      ) : (
        <div className="space-y-2">
          {combinations.map((combo) => {
            const isEditing = draft?.mode === 'edit' && draft.editingId === combo.id
            if (isEditing) return null // rendered below in draft form
            const memberLabels = combo.tableIds.map((tid) => {
              const t = combinableTables.find((x) => x.id === tid)
              return t ? tableDisplayLabel(t, labels.tableLabel) : tid
            })
            const errs = deleteErrors[combo.id] ?? []
            return (
              <div
                key={combo.id}
                className="flex flex-col gap-1 rounded-lg border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-gray-800">
                    {combo.name ?? memberLabels.join(' + ')}
                  </span>
                  <span className="text-xs text-gray-500">
                    {memberLabels.join(' + ')} &middot; {combo.capacity} {labels.capacity.toLowerCase()}
                  </span>
                  {errs.length > 0 && (
                    <span className="text-xs text-red-600">{errs.join(', ')}</span>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(combo)}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    {labels.edit}
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === combo.id}
                    onClick={() => void handleDelete(combo.id)}
                    className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {labels.delete}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Inline create / edit form */}
      {draft && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          {/* Table picker */}
          <div className="mb-3">
            <span className={LABEL}>{labels.tablesHeading}</span>
            <div className="flex flex-wrap gap-2">
              {combinableTables.map((t) => {
                const selected = draft.selectedTableIds.has(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTable(t.id)}
                    className={[
                      'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                      selected
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                    ].join(' ')}
                  >
                    {tableDisplayLabel(t, labels.tableLabel)}
                  </button>
                )
              })}
            </div>
            {draft.selectedTableIds.size < 2 && draft.selectedTableIds.size > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">{labels.errorMinTables}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Name (optional) */}
            <label className="block">
              <span className={LABEL}>{labels.name}</span>
              <input
                type="text"
                maxLength={80}
                placeholder={labels.namePlaceholder}
                className={INPUT}
                value={draft.name}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              />
            </label>

            {/* Capacity */}
            <label className="block">
              <span className={LABEL}>{labels.capacity}</span>
              <input
                type="number"
                min={2}
                max={100}
                className={INPUT}
                value={draft.capacity}
                onChange={(e) => setDraft((d) => (d ? { ...d, capacity: e.target.value } : d))}
              />
            </label>
          </div>

          {draft.errors.length > 0 && (
            <p className="mt-2 text-xs text-red-600">{draft.errors.join(', ')}</p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDraft}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void handleSave()}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {draft.saving ? labels.saving : labels.save}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
