'use client'

import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Switch from '@mui/material/Switch'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import type { MenuItemRecord } from '@repo/table-reservations-core'

export interface MenuItemRowLabels {
  soldOutTitle: string
  edit: string
  archive: string
  moveUp: string
  moveDown: string
  soldOutBadge: string
  currencyPrefix: string
}

export interface MenuItemRowProps {
  item: MenuItemRecord
  labels: MenuItemRowLabels
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleSoldOut: (soldOut: boolean) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onEdit: () => void
  onArchive: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

export function MenuItemRow({
  item,
  labels,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleSoldOut,
  onEdit,
  onArchive,
}: MenuItemRowProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-gray-200 bg-white px-3 py-2 sm:flex-nowrap ${
        item.soldOut ? 'opacity-60' : ''
      }`}
    >
      {/* Below sm: image + name + price on the first line; reorder arrows and the
          sold-out / edit / archive controls move to a second line with 40px targets.
          From sm up the single-row desktop layout is unchanged. */}
      <div className="order-last h-0 basis-full sm:hidden" aria-hidden />
      <div className="order-last flex gap-0.5 sm:order-none sm:flex-col">
        <Tooltip title={labels.moveUp}>
          <span>
            <IconButton size="small" disabled={!canMoveUp} onClick={onMoveUp} sx={{ p: 0.25 }} className="size-10 sm:size-auto">
              <ArrowUpwardIcon sx={{ fontSize: '0.9rem' }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={labels.moveDown}>
          <span>
            <IconButton size="small" disabled={!canMoveDown} onClick={onMoveDown} sx={{ p: 0.25 }} className="size-10 sm:size-auto">
              <ArrowDownwardIcon sx={{ fontSize: '0.9rem' }} />
            </IconButton>
          </span>
        </Tooltip>
      </div>

      {item.imageUrl ? (
        // Plain <img> — the UI package is framework-neutral; consumers use their
        // own Image component if they want Next.js optimization.
        <img
          src={item.imageUrl}
          alt={item.name}
          className="h-12 w-12 shrink-0 rounded-sm object-cover border border-gray-200"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-sm bg-gray-100 border border-gray-200" />
      )}

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
          {item.soldOut && (
            <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm">
              {labels.soldOutBadge}
            </span>
          )}
        </div>
        {item.description && (
          <span className="text-xs text-gray-500 truncate">{item.description}</span>
        )}
      </div>

      <div className="text-sm font-medium text-gray-900 tabular-nums shrink-0 text-right sm:w-20">
        {labels.currencyPrefix}
        {/* Gross price; pre-v2 rows may have totalPrice 0 — fall back to the legacy price. */}
        {(item.totalPrice > 0 ? item.totalPrice : item.price).toFixed(2)}
      </div>

      <div className="order-last ml-auto flex items-center gap-1 sm:order-none sm:ml-0 sm:gap-3">
        <Tooltip title={labels.soldOutTitle}>
          <Switch
            size="small"
            checked={item.soldOut}
            onChange={(e) => void onToggleSoldOut(e.target.checked)}
          />
        </Tooltip>

        <Tooltip title={labels.edit}>
          <IconButton size="small" onClick={onEdit} className="size-10 sm:size-auto">
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={labels.archive}>
          <IconButton size="small" color="error" onClick={() => void onArchive()} className="size-10 sm:size-auto">
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  )
}
