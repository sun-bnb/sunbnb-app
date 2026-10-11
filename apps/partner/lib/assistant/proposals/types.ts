/**
 * Proposal model for the assistant's tab writes (track 030 S3).
 *
 * A write tool NEVER mutates: it builds a `payload` (normalised intent, names not ids) and a `Diff`
 * (the before -> after the user reviews), stores both as an `AssistantAction`, and stops. A
 * `KindHandler` is the one place that knows how to (1) diff a payload against the CURRENT database
 * state, (2) snapshot, (3) execute through the EXISTING server actions, and (4) restore.
 *
 * Staleness is a single idea: `diff(payload)` against fresh state must equal the diff the user was
 * shown (apply), or must be EMPTY (undo -- the applied state is still intact).
 */

export type Scalar = string | number | boolean | null

export interface Change {
  /** What is being changed: 'Site', 'Product "Mojito"', 'Hours Mon', ... */
  target: string
  field: string
  label: string
  before: Scalar
  after: Scalar
}

export interface Create {
  target: string
  fields: Record<string, Scalar>
}

export interface Remove {
  target: string
  label: string
}

/** A seat position in the site's layout mode: geo = lat/lng, schematic = x/y metres. */
export interface GeoPoint { lat?: number; lng?: number; x?: number; y?: number }
export interface GeoPose extends GeoPoint { rotation: number }

/**
 * Map preview of an inventory proposal (track 030 S4a), rendered as a ghost overlay. Computed by the
 * SAME pure functions apply runs (inventory/geometry.ts), so preview == result. `truncated` = the
 * per-seat lists were dropped (very large parcels): draw `parcels` footprints only.
 */
export interface InventoryGeometry {
  mode: 'geo' | 'schematic'
  moved: Array<{ id: string; label: string; before: GeoPose; after: GeoPose }>
  added: Array<{ tempId: string; label?: string; at: GeoPose; parcel?: number }>
  removed: Array<{ id: string; label: string }>
  parcels?: Array<{ number: number; footprint: GeoPoint[] }>
  truncated?: boolean
  /**
   * Schematic LAYOUT ELEMENTS (kinds `layout_elements`, track 030 S4c); `mode` is 'schematic' and the
   * seat lists above are empty. Rects are top-left x,y + width/height in metres, rotation in degrees
   * about the centre. `removed` carries no geometry: the editor looks the element up by `id`.
   */
  elements?: {
    added: Array<{ tempId: string; type: string; shape: string; label: string | null; x: number; y: number; w: number; h: number; rotation: number }>
    moved: Array<{ id: string; label: string; before: ElementRect; after: ElementRect }>
    removed: Array<{ id: string; label: string }>
  }
}
export interface ElementRect { x: number; y: number; w: number; h: number; rotation: number }

/** The user-facing review: exactly the contract the proposal card renders. */
export interface Diff {
  changes: Change[]
  creates?: Create[]
  deletes?: Remove[]
  warnings?: string[]
  /** Map preview (inventory proposals only). */
  geometry?: InventoryGeometry
  /**
   * Photo placement (kind `place_image`): what the card can show as a before / after thumbnail.
   * `imageUrl` is the user's upload (may be a PRIVATE blob URL the browser cannot fetch: the card
   * must fall back to the text change); `previousUrl` is the target's current public URL, or null.
   */
  image?: {
    target: string
    targetLabel: string
    imageUrl: string
    previousUrl: string | null
    /** The upload id: the card shows the new photo through GET /api/assistant/uploads/[id] (private-safe). */
    uploadId?: string
    /** Display name of the uploaded file (no URL). */
    fileName?: string
    /** Product / rental item name for those targets. */
    itemName?: string
  }
  /** Handler-authored one-line summary (a URL-free sentence); `summarizeDiff` returns it verbatim. */
  summary?: string
  /**
   * Opaque fingerprint of the exact state the diff was computed from (inventory: every loaded seat /
   * ItemGroup row). Part of the staleness identity, never shown.
   */
  basis?: string
}

export const isEmptyDiff = (d: Diff): boolean =>
  d.changes.length === 0 && !(d.creates?.length) && !(d.deletes?.length)

/** A user-visible rejection of a proposal request or an apply step (the model / the card shows it). */
export class ProposalError extends Error {
  constructor(message: string, public readonly steps: string[] = []) {
    super(message)
    this.name = 'ProposalError'
  }
}

export interface HandlerCtx {
  siteId: string
  /** The site owner's account id (== PartnerAccount.userId). */
  accountId: string
}

export interface KindHandler<P = unknown, S = unknown> {
  kind: string
  /**
   * The diff of `payload` against the database NOW. Throws ProposalError on ambiguity / invalid state.
   * `applied: true` = verifying an already-applied payload (undo): rows the payload deleted are
   * expected to be gone rather than an error.
   */
  diff(ctx: HandlerCtx, payload: P, opts?: { applied?: boolean }): Promise<Diff>
  /** Current values of everything the payload touches (restorable, raw). Taken just before execute. */
  snapshot(ctx: HandlerCtx, payload: P): Promise<S>
  /**
   * Run through the existing actions. Push each finished step's name onto `done`; throw a
   * ProposalError (message = the action's error) on the first failure and stop.
   */
  execute(ctx: HandlerCtx, payload: P, done: string[]): Promise<void>
  /** Null when undo is safe, else why not (e.g. a created row now has orders). */
  undoBlocker?(ctx: HandlerCtx, payload: P, snapshot: S): Promise<string | null>
  /**
   * Make state equal to `snapshot` again for everything the payload touches. Idempotent.
   * `only` (a failed apply's finished steps) limits a ROLLBACK to what actually ran, so a step that
   * failed is not retried while undoing; omitted = restore everything (user undo).
   */
  restore(ctx: HandlerCtx, payload: P, snapshot: S, only?: string[]): Promise<void>
}

/** Plain-text summary used for the card title, the tool result and the conversation note. */
export function summarizeDiff(diff: Diff): string {
  if (diff.summary) return diff.summary.length > 300 ? `${diff.summary.slice(0, 297)}...` : diff.summary
  const parts: string[] = []
  const byTarget = new Map<string, Change[]>()
  for (const c of diff.changes) byTarget.set(c.target, [...(byTarget.get(c.target) ?? []), c])
  for (const [target, cs] of byTarget) {
    if (cs.length === 1) {
      const c = cs[0]!
      parts.push(`Changed ${target.toLowerCase() === 'site' ? 'site' : target} ${c.label.toLowerCase()} ${show(c.before)} → ${show(c.after)}`)
    } else {
      parts.push(`Changed ${target.toLowerCase() === 'site' ? 'site' : target}: ${cs.map((c) => c.label.toLowerCase()).join(', ')}`)
    }
  }
  const creates = diff.creates?.length ?? 0
  if (creates) parts.push(`Added ${diff.creates!.map((c) => c.target).join(', ')}`)
  const deletes = diff.deletes?.length ?? 0
  if (deletes) parts.push(`Removed ${diff.deletes!.map((d) => d.target).join(', ')}`)
  const text = parts.join('. ')
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
}

function show(v: Scalar): string {
  if (v === null || v === '') return 'empty'
  if (typeof v === 'string') return v.length > 60 ? `"${v.slice(0, 57)}..."` : v.includes(' ') ? `"${v}"` : v
  return String(v)
}

/**
 * Stable identity of what a diff changes, for the "is this still the proposal I reviewed" check.
 * ORDER-INDEPENDENT: the payload round-trips through a Postgres `jsonb` column, which does not keep
 * object key order, so a diff rebuilt from the stored payload can list the same changes in another
 * order (found by the integration tests, invisible to mocks).
 */
export function diffBasis(d: Diff): string {
  const sorted = (xs: string[]) => [...xs].sort()
  return JSON.stringify({
    c: sorted(d.changes.map((c) => JSON.stringify([c.target, c.field, c.before]))),
    a: sorted((d.creates ?? []).map((c) => c.target)),
    r: sorted((d.deletes ?? []).map((x) => x.target)),
    b: d.basis ?? null,
  })
}

/** Equal when treating null and '' alike (a cleared text field). */
export const norm = (v: unknown): unknown => (v === '' || v === undefined ? null : v)
