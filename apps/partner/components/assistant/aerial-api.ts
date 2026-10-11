/**
 * Client-side access to the S7c aerial endpoints (track 030). Everything network / server-action
 * related for the alignment mode lives here so the store and UI stay pure-ish and testable.
 */
import type { Georef } from '@repo/agent/geo/georef'

export type ExtractStatus = 'running' | 'done' | 'failed'

export const imageUrl = (uploadId: string): string => `/api/assistant/uploads/${encodeURIComponent(uploadId)}/image`

export function toExtractStatus(v: unknown): ExtractStatus {
  return v === 'running' || v === 'done' ? v : 'failed'
}

/** `POST /api/assistant/aerial/[uploadId]/extract` - idempotent; may block while it extracts. */
export async function postExtract(uploadId: string, signal?: AbortSignal): Promise<ExtractStatus> {
  try {
    const res = await fetch(`/api/assistant/aerial/${encodeURIComponent(uploadId)}/extract`, {
      method: 'POST',
      credentials: 'same-origin',
      signal,
    })
    if (!res.ok) return 'failed'
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null
    return toExtractStatus(body?.status)
  } catch {
    return 'failed'
  }
}

export interface PollOptions {
  post: () => Promise<ExtractStatus>
  sleep: (ms: number) => Promise<void>
  /** Stop quietly (returns null) once true - the user closed the mode or a newer run started. */
  isCancelled?: () => boolean
  intervalMs?: number
  /** Total POSTs before giving up as failed. */
  maxAttempts?: number
}

/** Re-POSTs while the server reports `running` (the endpoint is idempotent), until done/failed. */
export async function pollExtract(o: PollOptions): Promise<ExtractStatus | null> {
  const { intervalMs = 3000, maxAttempts = 100 } = o
  for (let i = 0; i < maxAttempts; i++) {
    if (o.isCancelled?.()) return null
    const status = await o.post()
    if (o.isCancelled?.()) return null
    if (status !== 'running') return status
    await o.sleep(intervalMs)
  }
  return 'failed'
}

export type SaveGeorefResult = { status: 'ok' } | { status: 'error'; errors?: string[] }

/** Persists the confirmed alignment (`saveUploadGeoref`, S7c server action; loaded lazily). */
export async function saveGeoref(uploadId: string, georef: Georef): Promise<SaveGeorefResult> {
  try {
    const { saveUploadGeoref } = await import('@/app/assistant/aerial-actions')
    return await saveUploadGeoref(uploadId, georef)
  } catch {
    return { status: 'error' }
  }
}
