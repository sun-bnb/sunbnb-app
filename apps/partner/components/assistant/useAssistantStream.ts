'use client'

import { useCallback, useSyncExternalStore } from 'react'
import * as store from './assistant-store'
import type { AssistantPageContext } from './context-payload'
import { INITIAL_STATE, type AttachmentInfo } from './stream-reducer'

/**
 * React binding over the module store. Exposes the chat surface the drawer
 * needs; `getContext` is read at send time so the message carries the
 * selection as it is *then*, not as of the last render.
 */
export function useAssistantStream(siteId: string, getContext: () => AssistantPageContext) {
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState(siteId),
    () => INITIAL_STATE,
  )

  const send = useCallback(
    (text: string, attachments?: AttachmentInfo[]) => store.send(siteId, text, getContext, attachments),
    [siteId, getContext],
  )
  const stop = useCallback(() => store.stop(siteId), [siteId])
  const newConversation = useCallback(() => store.newConversation(siteId), [siteId])
  const setOpen = useCallback(
    (open: boolean) => store.dispatch(siteId, { type: open ? 'open' : 'close' }),
    [siteId],
  )
  const toggle = useCallback(() => store.dispatch(siteId, { type: 'toggle' }), [siteId])
  const probe = useCallback(() => store.probe(siteId), [siteId])

  return {
    messages: state.messages,
    status: state.status,
    error: state.error,
    conversationId: state.conversationId,
    open: state.open,
    availability: state.availability,
    send,
    stop,
    newConversation,
    setOpen,
    toggle,
    probe,
  }
}
