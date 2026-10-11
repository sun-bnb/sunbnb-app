/**
 * Pure rules for resyncing client form state after the server copy changed underneath it (the
 * assistant's Apply/Undo writes through server actions; `router.refresh()` does not reset `useState`).
 *
 * The merge rule, per field: reset to the fresh server value ONLY when the server value actually
 * changed AND the user has not edited the field. "Edited" = the local value differs from the server
 * value we last knew (`prev`). A field the user is mid-typing is therefore never clobbered, and a
 * field whose server value did not move is never touched.
 */

export interface ReconcileResult<T extends Record<string, string>> {
  /** The next local values (unchanged fields keep their local value). */
  values: T
  /** Fields reset to the fresh server value. */
  reset: (keyof T)[]
  /** Fields where the server moved but the user's own edit was kept. */
  kept: (keyof T)[]
}

export function reconcileField(local: string, prev: string, next: string): { value: string; outcome: 'same' | 'reset' | 'kept' } {
  if (next === prev) return { value: local, outcome: 'same' }
  if (local === next) return { value: local, outcome: 'same' }
  if (local === prev) return { value: next, outcome: 'reset' }
  return { value: local, outcome: 'kept' }
}

export function reconcileFields<T extends Record<string, string>>(local: T, prev: T, next: T): ReconcileResult<T> {
  const values = { ...local }
  const reset: (keyof T)[] = []
  const kept: (keyof T)[] = []
  for (const key of Object.keys(next) as (keyof T)[]) {
    const r = reconcileField(local[key] as string, (prev[key] ?? next[key]) as string, next[key] as string)
    values[key] = r.value as T[keyof T]
    if (r.outcome === 'reset') reset.push(key)
    else if (r.outcome === 'kept') kept.push(key)
  }
  return { values, reset, kept }
}

/** Order-insensitive equality for string lists (services, features). */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every(x => s.has(x))
}

/** Canonical string for a string-list field so it can go through `reconcileFields`. */
export const listKey = (xs: readonly string[] | null | undefined): string => [...(xs ?? [])].sort().join('\u0000')
export const fromListKey = (k: string): string[] => (k === '' ? [] : k.split('\u0000'))

/** Anything with a clearable timer handle (a React ref). */
export interface TimerRef { current: ReturnType<typeof setTimeout> | null }

/** Cancel a pending debounced save. Returns true when one was pending. */
export function cancelPendingSave(ref: TimerRef): boolean {
  if (ref.current === null) return false
  clearTimeout(ref.current)
  ref.current = null
  return true
}

/**
 * Does an assistant-applied event concern this tab? A subscriber lists plain kinds (`products`) and,
 * for kinds that span several tabs, `kind:target` (`place_image:cover`): `place_image` is ONE kind that
 * writes the cover, product / rental images, brand images and the schematic underlay, so only the tab
 * showing the written slot should refetch. A bare `place_image` subscription matches every target.
 */
export function concerns(kinds: readonly string[], kind: string, target?: string | null): boolean {
  if (kinds.includes(kind)) return true
  return !!target && kinds.includes(`${kind}:${target}`)
}

/** The `Diff.image.target` of a stored proposal preview (only `place_image` carries one). */
export function imageTargetOf(preview: unknown): string | undefined {
  if (!preview || typeof preview !== 'object') return undefined
  const image = (preview as { image?: unknown }).image
  if (!image || typeof image !== 'object') return undefined
  const t = (image as { target?: unknown }).target
  return typeof t === 'string' && t ? t : undefined
}
