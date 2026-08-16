// Pure helpers — real implementations (no DB), mirrored from @repo/data/seat-label.
// (DB-backed recompute/backfill live in the @repo/data/seat-label-db mock.)
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

// Track 021 P3: the label computation also reports the ordinal each unit ended
// up with, so the DB layer can persist it. Stubbed like its sibling — partner
// unit tests never exercise the computation itself.
export function computeSeatLabelsWithUnits(): {
  labels: Map<string, string>
  unitSeqs: Map<string, number>
} {
  return { labels: new Map(), unitSeqs: new Map() }
}
