'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { openAlign } from './photo-align-store'
import { useIsDesktop } from './useIsDesktop'
import { usePhotoAlign } from './usePhotoAlign'
import type { AlignPhotoRequest } from './stream-reducer'

/**
 * The assistant asked the user to align an uploaded aerial photo (`align_photo`). The mode itself
 * opens when the event arrives; this chip is the way back in (after Cancel) and the way to the
 * inventory tab when the user is elsewhere. Phones get an explanation instead: the map editor is
 * desktop-only.
 */
export default function AlignPhotoRequestButton({
  request,
  siteId,
  tab,
}: {
  request: AlignPhotoRequest
  siteId: string
  tab: string
}) {
  const t = useTranslations('Assistant.align')
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const align = usePhotoAlign(siteId)
  const here = tab === 'inventory'
  const alreadyOpen = here && align.active && align.request?.uploadId === request.uploadId

  if (!isDesktop) {
    return <p className="max-w-[92%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{t('desktopOnly')}</p>
  }
  return (
    <button
      type="button"
      disabled={alreadyOpen}
      onClick={() => {
        openAlign(siteId, request)
        if (!here) router.push(`/sites/${siteId}/inventory`)
      }}
      className="btn-ghost min-h-[40px] border border-gray-200 bg-white text-xs disabled:opacity-60 lg:min-h-0"
    >
      {alreadyOpen ? t('chipOpen') : t('chip')}
    </button>
  )
}
