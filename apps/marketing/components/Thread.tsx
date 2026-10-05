'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attach, Msg } from '@/lib/journey.ts'

/** Messages shown before "Show conversation" — the product stays in front, the chat behind. */
const VISIBLE = 3

/**
 * The conversation, floating over the world (track 027 D11). No window, no header: the agent's
 * short lines on the left, the visitor's actions and words on the right, and the live step UI
 * riding on the latest agent message. Older lines fade upward into the scene.
 */
export default function Thread({
  msgs,
  live,
  typing,
  renderAttach,
}: {
  msgs: Msg[]
  /** The message whose attachment is interactive. */
  live: { id: number; attach: Attach } | null
  typing: boolean
  renderAttach: (attach: Attach) => ReactNode
}) {
  const t = useTranslations('Thread')
  const [expanded, setExpanded] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // Collapsed, but never hiding the live step UI however much was typed after it.
  const liveIdx = live ? msgs.findIndex((m) => m.id === live.id) : -1
  const start = Math.max(0, Math.min(msgs.length - VISIBLE, liveIdx < 0 ? Infinity : liveIdx))
  const shown = expanded ? msgs : msgs.slice(start)
  const hidden = msgs.length - shown.length

  useEffect(() => {
    // Scroll the thread itself, never the page.
    const box = boxRef.current
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  }, [msgs.length, typing, live?.id])

  const text = (m: Msg) => m.text ?? (m.key ? t(m.key, m.params) : '')

  return (
    <div
      ref={boxRef}
      className={`flex flex-col gap-2 overflow-y-auto overscroll-contain pt-6 ${expanded ? 'max-h-[60svh] rounded-2xl bg-[#fff5e1]/85 px-2 backdrop-blur' : 'max-h-[46svh]'}`}
      // Older lines dissolve into the scene instead of stacking up like a chat log.
      style={expanded ? undefined : { maskImage: 'linear-gradient(to bottom, transparent 0, black 2.5rem)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 2.5rem)' }}
      aria-live="polite"
    >
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="self-center rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-[#0e3a4a]/70 shadow-sm backdrop-blur">
          {t('showConversation', { count: hidden })}
        </button>
      )}
      {expanded && (
        <button type="button" onClick={() => setExpanded(false)} className="sticky top-0 z-10 self-center rounded-full bg-white px-3 py-1 text-xs font-medium text-[#0e3a4a]/70 shadow-sm">
          {t('hideConversation')}
        </button>
      )}

      {shown.map((m, i) => {
        const prev = shown[i - 1]
        const first = !prev || prev.from !== m.from
        return m.from === 'me' ? (
          <div key={m.id} className="flex animate-[pop_200ms_ease-out] justify-end pl-12">
            <p className="rounded-2xl rounded-br-md bg-[#0e3a4a] px-3.5 py-2 text-[15px] leading-snug text-white shadow-md">{text(m)}</p>
          </div>
        ) : (
          <div key={m.id} className="flex animate-[pop_220ms_ease-out] items-end gap-2 pr-6">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[#0e3a4a] bg-[#00cef1] text-xs font-bold text-[#0e3a4a] ${first ? '' : 'invisible'}`} aria-hidden>
              S
            </span>
            <div className="min-w-0 flex-1">
              <p className="inline-block rounded-2xl rounded-bl-md bg-white/95 px-3.5 py-2 text-[15px] leading-snug text-[#0e3a4a] shadow-md backdrop-blur">{text(m)}</p>
              {live?.id === m.id && <div className="mt-2">{renderAttach(live.attach)}</div>}
            </div>
          </div>
        )
      })}

      {typing && (
        <div className="flex items-end gap-2">
          <span className="h-8 w-8 shrink-0" aria-hidden />
          <p className="flex gap-1 rounded-2xl rounded-bl-md bg-white/95 px-3.5 py-3 shadow-md" aria-label={t('typing')}>
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0e3a4a]/50" style={{ animationDelay: `${d * 120}ms` }} />
            ))}
          </p>
        </div>
      )}
    </div>
  )
}
