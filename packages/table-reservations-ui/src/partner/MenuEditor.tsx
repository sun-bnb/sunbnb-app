'use client'

import { useMemo, useState } from 'react'
import Button from '@mui/material/Button'
import AddIcon from '@mui/icons-material/Add'
import type { MenuItemRecord } from '@repo/table-reservations-core'
import { MenuItemDialog, type MenuItemDialogLabels } from './MenuItemDialog'
import { MenuItemRow, type MenuItemRowLabels } from './MenuItemRow'
import type { MenuItemFormValues, MenuItemSaveResult } from './menu-types'

export interface MenuEditorLabels {
  addItem: string
  emptyTitle: string
  emptyHint: string
  categoryFallback: string
  dialog: MenuItemDialogLabels
  row: MenuItemRowLabels
}

export interface MenuEditorProps {
  items: MenuItemRecord[]
  labels: MenuEditorLabels
  onCreate: (values: MenuItemFormValues) => Promise<MenuItemSaveResult>
  onUpdate: (id: string, values: MenuItemFormValues) => Promise<MenuItemSaveResult>
  onArchive: (id: string) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onToggleSoldOut: (id: string, soldOut: boolean) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onReorder: (ids: string[]) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

/**
 * Partner-side menu editor. Items grouped by category, drag-free "move up /
 * move down" reordering within a flat list via arrow buttons. Adding and
 * editing happen in a modal dialog.
 */
export function MenuEditor({
  items,
  labels,
  onCreate,
  onUpdate,
  onArchive,
  onToggleSoldOut,
  onReorder,
}: MenuEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MenuItemRecord | null>(null)

  const ordered = useMemo(() => items.slice().sort((a, b) => a.displayOrder - b.displayOrder), [items])

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItemRecord[]>()
    for (const item of ordered) {
      const cat = item.category || labels.categoryFallback
      const arr = map.get(cat) ?? []
      arr.push(item)
      map.set(cat, arr)
    }
    return Array.from(map.entries())
  }, [ordered, labels.categoryFallback])

  const moveItem = async (id: string, direction: -1 | 1) => {
    const idx = ordered.findIndex((i) => i.id === id)
    if (idx < 0) return
    const target = idx + direction
    if (target < 0 || target >= ordered.length) return
    const next = ordered.slice()
    const a = next[idx]
    const b = next[target]
    if (!a || !b) return
    next[idx] = b
    next[target] = a
    await onReorder(next.map((i) => i.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div />
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon fontSize="small" />}
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          sx={{ textTransform: 'none' }}
        >
          {labels.addItem}
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <div className="text-sm font-medium text-gray-700">{labels.emptyTitle}</div>
          <div className="text-xs text-gray-500 mt-1">{labels.emptyHint}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(([category, group]) => (
            <section key={category}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {category}
              </h3>
              <div className="flex flex-col gap-2">
                {group.map((item) => (
                  <MenuItemRow
                    key={item.id}
                    item={item}
                    labels={labels.row}
                    canMoveUp={ordered.findIndex((i) => i.id === item.id) > 0}
                    canMoveDown={
                      ordered.findIndex((i) => i.id === item.id) < ordered.length - 1
                    }
                    onMoveUp={() => moveItem(item.id, -1)}
                    onMoveDown={() => moveItem(item.id, 1)}
                    onToggleSoldOut={(soldOut) => onToggleSoldOut(item.id, soldOut)}
                    onEdit={() => {
                      setEditing(item)
                      setDialogOpen(true)
                    }}
                    onArchive={() => onArchive(item.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <MenuItemDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        labels={labels.dialog}
        initial={
          editing
            ? {
                name: editing.name,
                description: editing.description ?? '',
                totalPrice: editing.totalPrice > 0 ? editing.totalPrice : editing.price,
                tax: editing.tax,
                category: editing.category,
                imageUrl: editing.imageUrl,
              }
            : null
        }
        onSubmit={async (values) => {
          const res = editing ? await onUpdate(editing.id, values) : await onCreate(values)
          if (res.status === 'ok') setDialogOpen(false)
          return res
        }}
      />
    </div>
  )
}
