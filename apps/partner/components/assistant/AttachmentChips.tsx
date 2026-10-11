'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { hasThumbnail, uploadThumbSrc } from './proposal-model'
import { iconFor, type AttachmentIcon, type Chip } from './attachment-chips'
import type { AttachmentInfo } from './stream-reducer'

function FileIcon({ icon, className = 'h-3.5 w-3.5 shrink-0' }: { icon: AttachmentIcon; className?: string }) {
  const d =
    icon === 'image'
      ? 'm2.25 15.75 5.16-5.16a2.25 2.25 0 0 1 3.18 0l5.16 5.16m-1.5-1.5 1.41-1.41a2.25 2.25 0 0 1 3.18 0l2.25 2.25m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z'
      : 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z'
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

/** Pending files in the composer: uploading spinner, error state, remove button. */
export function ComposerChips({ chips, onRemove }: { chips: Chip[]; onRemove: (key: string) => void }) {
  const t = useTranslations('Assistant.attachments')
  if (chips.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('list')}>
      {chips.map((c) => {
        const tone = c.status === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-700'
        return (
          <li key={c.key} className={`badge max-w-full border ${tone}`} title={c.error ? t(`errors.${c.error}`) : c.name}>
            {c.status === 'uploading' ? (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" aria-hidden="true" />
            ) : (
              <FileIcon icon={iconFor({ name: c.name, type: c.mime, kind: c.kind })} />
            )}
            <span className="max-w-[10rem] truncate">{c.name}</span>
            <span className="sr-only">
              {c.status === 'uploading' ? t('uploading') : c.status === 'error' ? `${t('failed')}: ${t(`errors.${c.error ?? 'unavailable'}`)}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onRemove(c.key)}
              aria-label={t('remove', { name: c.name })}
              className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-900"
            >
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.3 5 5 6.3 8.7 10 5 13.7 6.3 15l3.7-3.7 3.7 3.7 1.3-1.3L11.3 10 15 6.3 13.7 5 10 8.7 6.3 5Z" />
              </svg>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Chip({ a }: { a: AttachmentInfo }) {
  return (
    <>
      <FileIcon icon={iconFor(a)} />
      <span className="max-w-[12rem] truncate">{a.name}</span>
    </>
  )
}

/** Photo thumbnail from the account-scoped upload route; falls back to the chip if it cannot load (purged, HEIC). */
function Thumb({ a }: { a: AttachmentInfo }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="badge max-w-full border border-gray-200 bg-white text-gray-700"><Chip a={a} /></span>
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uploadThumbSrc(a.id!)}
      alt={a.name}
      title={a.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-16 w-16 rounded-lg border border-gray-200 bg-gray-50 object-cover"
    />
  )
}

/** Files on a sent user message (live or restored): photos as small thumbnails, everything else as chips. */
export function MessageAttachments({ items }: { items: AttachmentInfo[] }) {
  const t = useTranslations('Assistant.attachments')
  return (
    <ul className="flex max-w-[85%] flex-wrap items-end justify-end gap-1.5" aria-label={t('attached')}>
      {items.map((a, i) => (
        <li key={a.id ?? i} className="max-w-full">
          {hasThumbnail(a) ? <Thumb a={a} /> : <span className="badge max-w-full border border-gray-200 bg-white text-gray-700"><Chip a={a} /></span>}
        </li>
      ))}
    </ul>
  )
}
