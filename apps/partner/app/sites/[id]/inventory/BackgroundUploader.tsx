'use client'

import { useTransition } from 'react'
import { Button } from '@mui/material'
import { useRef } from 'react'
import { uploadBackground } from './actions'

export default function BackgroundUploader({ siteId }: { siteId: string }) {
  const [pending, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (!f) return
          const fd = new FormData()
          fd.append('image', f)
          start(async () => {
            await uploadBackground(siteId, fd)
            //sse.currentTarget.value = '' // reset
          })
        }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={pending}>
        {pending ? 'Uploading…' : 'Upload background'}
      </Button>
    </div>
  )
}
