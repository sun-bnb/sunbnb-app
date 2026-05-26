'use client'

import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Switch from '@mui/material/Switch'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
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
      className={`flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2 ${
        item.soldOut ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <Tooltip title={labels.moveUp}>
          <span>
            <IconButton size="small" disabled={!canMoveUp} onClick={onMoveUp} sx={{ p: 0.25 }}>
              <ArrowUpwardIcon sx={{ fontSize: '0.9rem' }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={labels.moveDown}>
          <span>
            <IconButton size="small" disabled={!canMoveDown} onClick={onMoveDown} sx={{ p: 0.25 }}>
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
          className="h-12 w-12 rounded object-cover border border-gray-200"
        />
      ) : (
        <div className="h-12 w-12 rounded bg-gray-100 border border-gray-200" />
      )}

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
          {item.soldOut && (
            <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              {labels.soldOutBadge}
            </span>
          )}
        </div>
        {item.description && (
          <span className="text-xs text-gray-500 truncate">{item.description}</span>
        )}
      </div>

      <div className="text-sm font-medium text-gray-900 tabular-nums w-20 text-right">
        {labels.currencyPrefix}
        {item.price.toFixed(2)}
      </div>

      <Tooltip title={labels.soldOutTitle}>
        <Switch
          size="small"
          checked={item.soldOut}
          onChange={(e) => void onToggleSoldOut(e.target.checked)}
        />
      </Tooltip>

      <Tooltip title={labels.edit}>
        <IconButton size="small" onClick={onEdit}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tooltip title={labels.archive}>
        <IconButton size="small" color="error" onClick={() => void onArchive()}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </div>
  )
}
