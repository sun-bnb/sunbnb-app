import { vi } from 'vitest'

export const sendRentalConfirmationEmail = vi.fn().mockResolvedValue(undefined)
export const sendRentalCancellationEmail = vi.fn().mockResolvedValue(undefined)
export const sendRentalDueReminders = vi.fn().mockResolvedValue(0)
