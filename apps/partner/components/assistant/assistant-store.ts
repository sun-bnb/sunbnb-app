'use client'

/**
 * Module-level store for assistant conversations, keyed by siteId.
 *
 * Why not React state: every site tab is its own `page.tsx`, so `SiteView`
 * remounts on tab navigation. A module store outlives the remount, which is
 * what makes the drawer (open state, history, even an in-flight stream)
 * persist across tabs without adding a shared layout above the site routes.
 */
import { createSseParser, toErrorCode, type AssistantErrorCode, type AssistantEvent } from './sse-parser'
import {
  INITIAL_STATE,
  reduce,
  type AssistantAction,
  type AssistantState,
  type AttachmentInfo,
  type HistoryMessage,
} from './stream-reducer'
import { openAlign } from './photo-align-store'
import { dispatchAssistantApplied } from './proposal-events'
import { imageTargetOf } from '@/lib/resync'
import { buildContextPayload, type AssistantPageContext } from './context-payload'

const ENDPOINT = '/api/assistant'
export const MAX_MESSAGE_LENGTH = 4000

const states = new Map<string, AssistantState>()
const listeners = new Set<() => void>()
const controllers = new Map<string, AbortController>()
const probes = new Map<string, Promise<void>>()
let counter = 0

const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getState(siteId: string): AssistantState {
  return states.get(siteId) ?? INITIAL_STATE
}

export function dispatch(siteId: string, action: AssistantAction): void {
  const prev = getState(siteId)
  const next = reduce(prev, action)
  if (next === prev) return
  states.set(siteId, next)
  listeners.forEach((l) => l())
}

function codeFromStatus(status: number, bodyCode: unknown): AssistantErrorCode {
  if (bodyCode) return toErrorCode(bodyCode)
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  if (status === 400) return 'bad_request'
  return 'unavailable'
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** One GET per site per page load: decides button visibility and preloads history. */
export function probe(siteId: string): Promise<void> {
  if (getState(siteId).availability !== 'unknown') return Promise.resolve()
  const inflight = probes.get(siteId)
  if (inflight) return inflight
  const p = (async () => {
    try {
      const res = await fetch(`${ENDPOINT}?siteId=${encodeURIComponent(siteId)}`, {
        credentials: 'same-origin',
      })
      if (res.status === 401 || res.status === 403) {
        dispatch(siteId, { type: 'probed', availability: 'hidden' })
      } else if (!res.ok) {
        dispatch(siteId, { type: 'probed', availability: 'unavailable' })
      } else {
        const body = await readJson(res)
        dispatch(siteId, {
          type: 'probed',
          availability: 'available',
          conversationId: typeof body?.conversationId === 'string' ? body.conversationId : null,
          history: Array.isArray(body?.messages) ? (body.messages as HistoryMessage[]) : [],
        })
      }
    } catch {
      dispatch(siteId, { type: 'probed', availability: 'unavailable' })
    } finally {
      probes.delete(siteId)
    }
  })()
  probes.set(siteId, p)
  return p
}

/** Feeds the reducer; `align_photo` additionally opens the map alignment mode (and starts extraction). */
function handleEvent(siteId: string, event: AssistantEvent): void {
  dispatch(siteId, { type: 'event', event })
  if (event.type === 'proposal' && event.status === 'applied') {
    // The assistant already wrote it: resync the tabs / map exactly like a manual Apply, and refresh the server tree.
    dispatchAssistantApplied({ kind: event.kind, actionId: event.actionId, target: imageTargetOf(event.preview), auto: true })
  }
  if (event.type === 'align_photo') {
    openAlign(siteId, { uploadId: event.uploadId, seed: event.seed, image: event.image })
  }
}

export async function send(
  siteId: string,
  rawText: string,
  getContext: () => AssistantPageContext,
  attachments: AttachmentInfo[] = [],
): Promise<void> {
  const text = rawText.trim()
  const state = getState(siteId)
  if (!text || text.length > MAX_MESSAGE_LENGTH || state.status !== 'idle') return

  const controller = new AbortController()
  controllers.set(siteId, controller)
  dispatch(siteId, { type: 'user_sent', userId: nextId(), assistantId: nextId(), text, attachments })

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        ...(state.conversationId ? { conversationId: state.conversationId } : {}),
        siteId,
        message: text,
        ...(attachments.length ? { attachments: attachments.map((a) => a.id).filter(Boolean) } : {}),
        context: buildContextPayload(getContext()),
      }),
    })

    if (!res.ok || !res.body) {
      const body = await readJson(res)
      dispatch(siteId, { type: 'failed', code: codeFromStatus(res.status, body?.code) })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const event of parser.push(decoder.decode(value, { stream: true }))) handleEvent(siteId, event)
    }
    for (const event of parser.flush()) handleEvent(siteId, event)
    dispatch(siteId, { type: 'ended' })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      dispatch(siteId, { type: 'stopped' })
    } else {
      dispatch(siteId, { type: 'failed', code: 'unavailable' })
    }
  } finally {
    if (controllers.get(siteId) === controller) controllers.delete(siteId)
  }
}

export function stop(siteId: string): void {
  controllers.get(siteId)?.abort()
}

export function newConversation(siteId: string): void {
  stop(siteId)
  dispatch(siteId, { type: 'reset' })
}
