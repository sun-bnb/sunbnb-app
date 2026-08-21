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

// Track 021: the inventory editor shows `{parcel}-{row}-{seq}-{member}` by
// unpacking the stored label, whose middle segment packs row and ordinal
// (`1-101-1`). REAL implementations, not stubs — these are pure string helpers
// and the partner tests assert what the editor actually renders.
export function parseSeatLabel(
  label: string | null | undefined,
): { parcel: number; row: number; seq: number; member: number } | null {
  if (!label) return null
  const parts = label.split('-')
  if (parts.length !== 3) return null
  const [parcelPart, middle, memberPart] = parts as [string, string, string]
  if (middle.length < 3) return null
  const address = {
    parcel: Number(parcelPart),
    row: Number(middle.slice(0, -2)),
    seq: Number(middle.slice(-2)),
    member: Number(memberPart),
  }
  const values = [address.parcel, address.row, address.seq, address.member]
  if (values.some((n) => !Number.isInteger(n) || n < 0)) return null
  return address
}

export function formatSeatId(
  item: { seatLabel?: string | null; number: number },
  options: { parcel?: boolean } = {},
): string {
  const address = parseSeatLabel(item.seatLabel)
  if (!address) return formatSeat(item, options)
  const { parcel = true } = options
  const head = parcel ? `${address.parcel}-` : ''
  return `${head}${address.row}-${address.seq}-${address.member}`
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

// REAL implementation, like its siblings above: pure arithmetic over the
// `parcel*10000 + row*100 + seatIdx` encoding, and the manage grid's parcel
// bucketing depends on it being right rather than stubbed.
export function decodeSeatNumber(number: number): { parcel: number; row: number; seatIdx: number } {
  return {
    parcel: Math.floor(number / 10000),
    row: Math.floor(number / 100) % 100,
    seatIdx: number % 100,
  }
}
