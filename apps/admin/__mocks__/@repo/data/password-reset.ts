import { vi } from 'vitest'

export const requestPasswordReset = vi.fn().mockResolvedValue({ ok: true })
export const resetPassword = vi.fn().mockResolvedValue({ ok: true })
