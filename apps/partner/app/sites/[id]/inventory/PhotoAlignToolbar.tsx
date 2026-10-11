'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveGeoref } from '@/components/assistant/aerial-api'
import { useAssistantPageContext } from '@/components/assistant/AssistantContext'
import * as assistant from '@/components/assistant/assistant-store'
import { pinning } from '@/components/assistant/photo-align'
import { closeAlign, dispatchAlign, startExtract } from '@/components/assistant/photo-align-store'
import { useAssistantStream } from '@/components/assistant/useAssistantStream'
import { useIsDesktop } from '@/components/assistant/useIsDesktop'
import { usePhotoAlign } from '@/components/assistant/usePhotoAlign'

/** Floating control panel for the photo alignment mode (track 030 S7d). */
export default function PhotoAlignToolbar({ siteId }: { siteId: string }) {
  const t = useTranslations('Assistant.align')
  const isDesktop = useIsDesktop()
  const align = usePhotoAlign(siteId)
  const getContext = useAssistantPageContext()
  const chat = useAssistantStream(siteId, getContext)
  const [busy, setBusy] = useState(false)

  if (!align.active || !align.request) return null

  const panel = 'absolute top-[62px] left-2.5 z-20 w-[320px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg'

  if (!isDesktop) {
    return (
      <div className={panel} role="status">
        <p className="text-sm text-gray-700">{t('desktopOnly')}</p>
        <button type="button" className="btn-ghost mt-2 min-h-[40px] text-xs" onClick={() => closeAlign(siteId)}>
          {t('cancel')}
        </button>
      </div>
    )
  }

  const pinMode = pinning(align.pins)
  const streaming = chat.status === 'streaming'
  const saving = busy || align.save === 'saving'
  const extractFailed = align.extract === 'failed'

  const confirm = async () => {
    if (!align.georef || !align.request || saving) return
    setBusy(true)
    dispatchAlign(siteId, { type: 'save', status: 'saving' })
    const res = await saveGeoref(align.request.uploadId, align.georef)
    setBusy(false)
    if (res.status !== 'ok') {
      dispatchAlign(siteId, { type: 'save', status: 'error' })
      return
    }
    closeAlign(siteId)
    assistant.dispatch(siteId, { type: 'open' })
    void assistant.send(siteId, t('canned'), getContext)
  }

  return (
    <div className={panel} role="region" aria-label={t('title')}>
      <h3 className="text-sm font-semibold text-gray-900">{t('title')}</h3>

      <p
        role="status"
        className={`mt-1 flex items-center gap-1.5 text-xs ${extractFailed ? 'text-red-600' : align.extract === 'done' ? 'text-green-700' : 'text-gray-500'}`}
      >
        {align.extract === 'running' && (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" aria-hidden="true" />
        )}
        {align.extract === 'done' ? t('readDone') : extractFailed ? t('readFailed') : t('reading')}
        {extractFailed && (
          <button type="button" className="underline" onClick={() => void startExtract(siteId)}>
            {t('retry')}
          </button>
        )}
      </p>

      <p className="mt-2 text-xs text-gray-600">{pinMode ? t(`pinStep.${align.pins.step}`) : t('hint')}</p>
      {align.pins.error && <p role="status" className="mt-1 text-xs text-amber-700">{t('pinDegenerate')}</p>}

      <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
        <span className="shrink-0">{t('opacity')}</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(align.opacity * 100)}
          onChange={(e) => dispatchAlign(siteId, { type: 'opacity', value: Number(e.target.value) / 100 })}
          className="w-full"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {pinMode ? (
          <>
            <button type="button" className="btn-ghost border border-gray-200 text-xs" onClick={() => dispatchAlign(siteId, { type: 'pin', action: { type: 'back' } })}>
              {t('pinBack')}
            </button>
            <button type="button" className="btn-ghost border border-gray-200 text-xs" onClick={() => dispatchAlign(siteId, { type: 'pin', action: { type: 'cancel' } })}>
              {t('pinCancel')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost border border-gray-200 text-xs" onClick={() => dispatchAlign(siteId, { type: 'pin', action: { type: 'start' } })}>
              {t('pin')}
            </button>
            <button type="button" className="btn-ghost border border-gray-200 text-xs" onClick={() => dispatchAlign(siteId, { type: 'reset' })}>
              {t('reset')}
            </button>
          </>
        )}
      </div>

      {align.save === 'error' && <p role="status" className="mt-2 text-xs text-red-600">{t('saveError')}</p>}
      {streaming && <p className="mt-2 text-xs text-gray-500">{t('waitReply')}</p>}

      <div className="mt-3 flex justify-end gap-2 border-t border-gray-100 pt-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => closeAlign(siteId)} disabled={saving}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => void confirm()}
          disabled={saving || streaming || pinMode || extractFailed}
        >
          {saving ? t('saving') : t('confirm')}
        </button>
      </div>
    </div>
  )
}
