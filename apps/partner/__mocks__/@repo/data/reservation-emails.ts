import { vi } from 'vitest'

export const sendCancellationEmail = vi.fn().mockResolvedValue(undefined)
export const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined)
export const sendReminderEmail = vi.fn().mockResolvedValue(undefined)
export const sendDueReminders = vi.fn().mockResolvedValue(0)
