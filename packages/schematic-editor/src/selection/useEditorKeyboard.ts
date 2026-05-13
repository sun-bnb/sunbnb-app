'use client'

import { useEffect } from 'react'

export interface UseEditorKeyboardOptions {
  /** Currently disabled (e.g. dialog open) — skip shortcuts entirely. */
  disabled?: boolean
  /** Escape clears all selection and exits any editor mode. */
  onEscape?: () => void
  /** Delete / Backspace removes the currently-selected item or element. */
  onDelete?: () => void
  /** Cmd-D / Ctrl-D — duplicate the selection. */
  onDuplicate?: () => void
  /** Cmd-C / Ctrl-C — copy the selection to the editor's internal clipboard. */
  onCopy?: () => void
  /** Cmd-V / Ctrl-V — paste from the editor's internal clipboard. */
  onPaste?: () => void
}

/**
 * Shared editor keyboard shortcuts. Ignores key events originating from
 * form fields (input, textarea, contenteditable) so editing text doesn't
 * accidentally delete items.
 */
export function useEditorKeyboard(opts: UseEditorKeyboardOptions): void {
  useEffect(() => {
    if (opts.disabled) return
    const handle = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      if (e.key === 'Escape') {
        opts.onEscape?.()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (opts.onDelete) {
          e.preventDefault()
          opts.onDelete()
        }
        return
      }
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'd' || e.key === 'D')) {
        if (opts.onDuplicate) {
          e.preventDefault()
          opts.onDuplicate()
        }
        return
      }
      if (meta && (e.key === 'c' || e.key === 'C')) {
        if (opts.onCopy) {
          e.preventDefault()
          opts.onCopy()
        }
        return
      }
      if (meta && (e.key === 'v' || e.key === 'V')) {
        if (opts.onPaste) {
          e.preventDefault()
          opts.onPaste()
        }
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [opts])
}
