'use client'

import { useTranslations } from 'next-intl'
import { dispatch } from './assistant-store'
import { dispatchPreview } from './preview-store'
import { useActivePreview } from './useGhostPreview'

/** Phone only: floating way back to the proposal after "View on map" closed the sheet. */
export default function PreviewChip({ siteId }: { siteId: string }) {
  const t = useTranslations('Assistant.preview')
  const { active, peek } = useActivePreview(siteId)
  if (!peek || !active) return null
  return (
    <button
      type="button"
      onClick={() => {
        dispatchPreview(siteId, { type: 'peek', value: false })
        dispatch(siteId, { type: 'open' })
      }}
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[55] flex min-h-[44px] -translate-x-1/2 items-center gap-2 rounded-full border border-blue-200 bg-white px-4 text-sm font-medium text-blue-700 shadow-lg lg:hidden"
    >
      <span aria-hidden="true">&larr;</span>
      {t('back')}
    </button>
  )
}
