/**
 * Window event fired after a proposal is applied or undone, so editors that
 * hold client state (inventory canvas, forms) can refetch beyond what
 * `router.refresh()` reaches.
 */
export const ASSISTANT_APPLIED_EVENT = 'assistant:applied'

export interface AssistantAppliedDetail {
  kind: string
  actionId: string
  /** Sub-target for kinds that span tabs (`place_image`: cover, product, ...). */
  target?: string
}

export function dispatchAssistantApplied(detail: AssistantAppliedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AssistantAppliedDetail>(ASSISTANT_APPLIED_EVENT, { detail }))
}

/** Subscribe; returns the unsubscribe function. */
export function onAssistantApplied(fn: (d: AssistantAppliedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const h = (e: Event) => fn((e as CustomEvent<AssistantAppliedDetail>).detail)
  window.addEventListener(ASSISTANT_APPLIED_EVENT, h)
  return () => window.removeEventListener(ASSISTANT_APPLIED_EVENT, h)
}
