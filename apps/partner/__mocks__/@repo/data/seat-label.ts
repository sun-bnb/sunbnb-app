import { vi } from 'vitest'

// DB-backed helpers are no-ops in unit tests (Prisma is mocked).
export const recomputeSeatLabels = vi.fn(async () => 0)
export const backfillAllSeatLabels = vi.fn(async () => 0)

// Pure helpers — real implementations (no DB), mirrored from @repo/data/seat-label.
export function formatSeatLabel(
  label: string | null | undefined,
  options: { parcel?: boolean } = {},
): string {
  if (!label) return ''
  const { parcel = true } = options
  if (parcel) return label
  const i = label.indexOf('-')
  return i === -1 ? label : label.slice(i + 1)
}

export function formatSeat(
  item: { seatLabel?: string | null; number: number },
  options: { parcel?: boolean } = {},
): string {
  if (item.seatLabel) return formatSeatLabel(item.seatLabel, options)
  return String(item.number).padStart(4, '0')
}

export function computeSeatLabels(): Map<string, string> {
  return new Map()
}
