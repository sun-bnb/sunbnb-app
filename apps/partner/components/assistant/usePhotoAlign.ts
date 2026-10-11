'use client'

import { useSyncExternalStore } from 'react'
import { getAlign, INITIAL_ALIGN, subscribeAlign, type AlignState } from './photo-align-store'

export function usePhotoAlign(siteId: string): AlignState {
  return useSyncExternalStore(subscribeAlign, () => getAlign(siteId), () => INITIAL_ALIGN)
}
