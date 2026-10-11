'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { useAssistantStream } from './useAssistantStream'
import { useAssistantPageContext } from './AssistantContext'
import { starterKeys } from './context-payload'
import { MAX_MESSAGE_LENGTH } from './assistant-store'
import type { AttachmentInfo, ChatMessage, ToolActivity } from './stream-reducer'
import Markdown from './Markdown'
import ProposalCard from './ProposalCard'
import QrPrintRequestButton from './QrPrintRequestButton'
import AlignPhotoRequestButton from './AlignPhotoRequestButton'
import PreviewChip from './PreviewChip'
import { ComposerChips, MessageAttachments } from './AttachmentChips'
import { useComposerAttachments } from './useComposerAttachments'
import { ACCEPT_ATTR, canSend, readyAttachments } from './attachment-chips'

export const ASSISTANT_TOGGLE_ID = 'assistant-toggle'

/** Tailwind `lg` (1024px): below it the drawer is a full-screen sheet. */
const DESKTOP_QUERY = '(min-width: 1024px)'
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  )
}

function SparkIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  )
}

/** Header button. Renders nothing when the assistant is forbidden for this account. */
export function AssistantToggle({ siteId, className = '' }: { siteId: string; className?: string }) {
  const t = useTranslations('Assistant')
  const getContext = useAssistantPageContext()
  const { availability, open, toggle, probe } = useAssistantStream(siteId, getContext)

  useEffect(() => {
    void probe()
  }, [probe])

  if (availability === 'hidden') return null
  return (
    <button
      id={ASSISTANT_TOGGLE_ID}
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-controls="assistant-drawer"
      className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[0.8rem] font-medium transition-colors ${
        open
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900'
      } ${className}`}
    >
      <SparkIcon />
      {t('toggle')}
    </button>
  )
}

function ToolChip({ tool }: { tool: ToolActivity }) {
  const t = useTranslations('Assistant')
  const tone =
    tool.status === 'failed'
      ? 'border-red-200 bg-red-50 text-red-600'
      : 'border-gray-200 bg-gray-50 text-gray-600'
  return (
    <li className={`badge border ${tone}`}>
      {tool.status === 'running' && (
        <span
          className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"
          aria-hidden="true"
        />
      )}
      {tool.status === 'done' && (
        <svg className="h-3 w-3 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.79 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
        </svg>
      )}
      {tool.status === 'failed' && (
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.3 5 5 6.3 8.7 10 5 13.7 6.3 15l3.7-3.7 3.7 3.7 1.3-1.3L11.3 10 15 6.3 13.7 5 10 8.7 6.3 5Z" />
        </svg>
      )}
      <span>{tool.label}</span>
      <span className="sr-only">
        {tool.status === 'running' ? t('toolRunning') : tool.status === 'done' ? t('toolDone') : t('toolFailed')}
      </span>
    </li>
  )
}

function Bubble({ message, streaming, siteId, tab }: { message: ChatMessage; streaming: boolean; siteId: string; tab: string }) {
  const t = useTranslations('Assistant')
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments && message.attachments.length > 0 && <MessageAttachments items={message.attachments} />}
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">
          <span className="sr-only">{t('you')}: </span>
          {message.text}
        </p>
      </div>
    )
  }
  const waiting = streaming && !message.text && message.tools.every((x) => x.status !== 'running')
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="sr-only">{t('assistant')}: </span>
      {message.tools.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('activity')}>
          {message.tools.map((tool, i) => <ToolChip key={i} tool={tool} />)}
        </ul>
      )}
      {message.text && (
        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-900">
          <Markdown text={message.text} />
        </div>
      )}
      {waiting && (
        <p className="px-1 text-xs text-gray-400" aria-hidden="true">{t('thinking')}</p>
      )}
      {message.proposals.map((p) => <ProposalCard key={p.actionId} proposal={p} siteId={siteId} />)}
      {message.qrPrints?.map((q, i) => <QrPrintRequestButton key={i} request={q} />)}
      {message.alignPhotos?.map((a, i) => <AlignPhotoRequestButton key={i} request={a} siteId={siteId} tab={tab} />)}
    </div>
  )
}

function PaperclipIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  )
}

function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  autoFocusKey,
  attachments,
}: {
  disabled: boolean
  streaming: boolean
  onSend: (text: string, attachments: AttachmentInfo[]) => void
  onStop: () => void
  autoFocusKey: boolean
  attachments: ReturnType<typeof useComposerAttachments>
}) {
  const t = useTranslations('Assistant')
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { chips, notice, addFiles, remove, clear } = attachments
  const sendable = canSend(chips, value)

  // Autosize up to ~6 lines.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  useEffect(() => {
    if (autoFocusKey) ref.current?.focus()
  }, [autoFocusKey])

  // Refocus after a reply finishes so the user can keep typing.
  useEffect(() => {
    if (!streaming && autoFocusKey) ref.current?.focus()
  }, [streaming, autoFocusKey])

  const submit = () => {
    if (!sendable || disabled || streaming) return
    const ready = readyAttachments(chips)
    // The server needs a non-empty message; a files-only send gets a localized default.
    const text = value.trim() || t('attachments.default')
    onSend(text, ready.map((c) => ({ id: c.id, name: c.name, kind: c.kind })))
    setValue('')
    clear()
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <ComposerChips chips={chips} onRemove={remove} />
      {notice && (
        <p role="status" className="text-xs text-red-600">
          {t(`attachments.errors.${notice}`)}
        </p>
      )}
      {chips.some((c) => c.status === 'error' && c.error) && (
        <p role="status" className="text-xs text-red-600">
          {t(`attachments.errors.${chips.find((c) => c.status === 'error')!.error!}`)}
        </p>
      )}
      <div className="flex items-end gap-2">
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept={ACCEPT_ATTR}
        tabIndex={-1}
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled || streaming}
        onClick={() => fileRef.current?.click()}
        aria-label={t('attachments.add')}
        title={`${t('attachments.add')} (${t('attachments.hint')})`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
      >
        <PaperclipIcon />
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={disabled || streaming}
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        onChange={(e) => setValue(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length > 0) {
            e.preventDefault()
            addFiles(files)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        className="input resize-none disabled:bg-gray-50 disabled:text-gray-400"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          className="min-h-[40px] shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('stop')}
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled || !sendable}
          className="btn-primary min-h-[40px] shrink-0"
        >
          {t('send')}
        </button>
      )}
      </div>
    </form>
  )
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function AssistantDrawer({ siteId, tab }: { siteId: string; tab: string }) {
  const t = useTranslations('Assistant')
  const getContext = useAssistantPageContext()
  const s = useAssistantStream(siteId, getContext)
  const isDesktop = useIsDesktop()
  const panelRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const attachments = useComposerAttachments(siteId)
  const [dragging, setDragging] = useState(false)

  const { open, setOpen, messages, status } = s
  const streaming = status === 'streaming'

  const close = useCallback(() => {
    setOpen(false)
    document.getElementById(ASSISTANT_TOGGLE_ID)?.focus()
  }, [setOpen])

  // Full-screen sheet: lock page scroll behind it.
  useEffect(() => {
    if (!open || isDesktop) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, isDesktop])

  // Keep the newest text in view unless the user scrolled up to read.
  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, s.error])

  if (!open || s.availability === 'hidden') return <PreviewChip siteId={siteId} />

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Tab' && !isDesktop && panelRef.current) {
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  const unavailable = s.availability === 'unavailable'
  const errorText = unavailable
    ? t('errors.unavailable')
    : s.error && s.error !== 'forbidden'
      ? t(`errors.${s.error}`)
      : null
  // Budget / rate-limit stop the composer; transient errors allow a retry.
  const blocked = unavailable || s.error === 'budget'
  const showStarters = messages.length === 0 && !blocked

  const sharedProps = {
    id: 'assistant-drawer',
    ref: panelRef,
    onKeyDown,
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragging(false)
      if (!blocked && !streaming) attachments.addFiles(Array.from(e.dataTransfer.files))
    },
    className:
      'flex flex-col bg-white fixed inset-0 z-[60] lg:sticky lg:top-4 lg:self-start lg:shrink-0 lg:z-auto lg:inset-auto lg:h-[calc(100dvh-5rem)] lg:rounded-xl lg:border lg:border-gray-200 lg:w-[400px]',
  }
  const panelProps = isDesktop
    ? { role: 'complementary', 'aria-label': t('title') }
    : { role: 'dialog', 'aria-modal': true, 'aria-label': t('title') }

  return (
    <aside {...sharedProps} {...panelProps}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-gray-400 bg-white/85 text-sm font-medium text-gray-700">
          {t('attachments.drop')}
        </div>
      )}
      <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:pt-3">
        <SparkIcon className="h-4 w-4 text-gray-500" />
        <h2 className="flex-1 text-sm font-semibold text-gray-900">{t('title')}</h2>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={s.newConversation}
            className="btn-ghost min-h-[40px] px-1 text-xs lg:min-h-0"
          >
            {t('newConversation')}
          </button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label={t('close')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:h-8 lg:w-8"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.length === 0 && (
          <div className="pt-4 text-center">
            <p className="text-sm font-medium text-gray-900">{t('emptyTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('emptyBody')}</p>
          </div>
        )}
        {showStarters && (
          <ul className="space-y-2" aria-label={t('starters')}>
            {starterKeys(tab).map((key) => {
              const prompt = t(`starter.${key}`)
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => {
                      stickRef.current = true
                      void s.send(prompt)
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-60"
                  >
                    {prompt}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {messages.map((m, i) => (
          <Bubble key={m.id} message={m} siteId={siteId} tab={tab} streaming={streaming && i === messages.length - 1} />
        ))}
        {errorText && (
          <div role="status" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorText}
          </div>
        )}
      </div>

      <Composer
        disabled={blocked}
        streaming={streaming}
        autoFocusKey={open}
        attachments={attachments}
        onSend={(text, files) => {
          stickRef.current = true
          void s.send(text, files)
        }}
        onStop={s.stop}
      />
    </aside>
  )
}
