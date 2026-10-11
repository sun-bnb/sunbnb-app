'use client'

import { useCallback, useReducer, useRef, useState } from 'react'
import { uploadAssistantFile } from '@/app/assistant/upload-actions'
import {
  chipReducer,
  isAcceptedFile,
  mapUploadError,
  remainingSlots,
  type AttachmentErrorKey,
  type Chip,
} from './attachment-chips'

let seq = 0

/** Owns the pending-file chips for one composer: starts uploads immediately and settles each chip. */
export function useComposerAttachments(siteId: string) {
  const [chips, dispatch] = useReducer(chipReducer, [] as Chip[])
  const chipsRef = useRef<Chip[]>([])
  chipsRef.current = chips
  const [notice, setNotice] = useState<AttachmentErrorKey | null>(null)

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      setNotice(null)
      let room = remainingSlots(chipsRef.current)
      for (const file of files) {
        if (!isAcceptedFile(file)) {
          setNotice(mapUploadError(['unsupported_type'], file))
          continue
        }
        if (room <= 0) {
          setNotice('limit')
          break
        }
        room--
        const key = `f${Date.now().toString(36)}${seq++}`
        dispatch({ type: 'add', key, name: file.name, mime: file.type })
        const fd = new FormData()
        fd.set('file', file)
        void uploadAssistantFile(siteId, fd)
          .then((r) =>
            r.status === 'ok'
              ? dispatch({ type: 'done', key, id: r.upload.id, kind: r.upload.kind })
              : dispatch({ type: 'failed', key, error: mapUploadError(r.errors, file) }),
          )
          .catch(() => dispatch({ type: 'failed', key, error: 'unavailable' }))
      }
    },
    [siteId],
  )

  const remove = useCallback((key: string) => dispatch({ type: 'remove', key }), [])
  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
    setNotice(null)
  }, [])

  return { chips, notice, addFiles, remove, clear }
}
