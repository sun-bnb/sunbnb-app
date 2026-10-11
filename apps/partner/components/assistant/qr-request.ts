/** Pure helpers for the assistant's `qr_print` request (track 030 S4b). */
import type { QrPrintRequest } from './stream-reducer'

export interface QrCandidate {
  group?: number | null
  seatLabel?: string | null
  label?: string | null
  number?: number | null
  status?: string | null
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** Seats the request asks for: the parcel's seats, narrowed by label when labels are given. */
export function selectQrItems<T extends QrCandidate>(items: readonly T[], req: QrPrintRequest): T[] {
  const labels = req.seatLabels?.length ? new Set(req.seatLabels.map(norm)) : null
  return items.filter((i) => {
    if (i.status === 'pool') return false
    if (req.parcel !== undefined && i.group !== req.parcel) return false
    if (!labels) return req.parcel !== undefined
    return [i.seatLabel, i.label, i.number].some((c) => c != null && labels.has(norm(c)))
  })
}

export function qrButtonTarget(req: QrPrintRequest): { kind: 'parcel'; parcel: number } | { kind: 'seats'; count: number } {
  return req.parcel !== undefined && !req.seatLabels?.length
    ? { kind: 'parcel', parcel: req.parcel }
    : { kind: 'seats', count: req.seatLabels?.length ?? 0 }
}
