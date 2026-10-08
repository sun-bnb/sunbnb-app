import { vi } from 'vitest'

export const sendCancellationEmail = vi.fn().mockResolvedValue(undefined)
export const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined)
export const sendReminderEmail = vi.fn().mockResolvedValue(undefined)
export const sendDueReminders = vi.fn().mockResolvedValue(0)
export const sendReceiptEmail = vi.fn().mockResolvedValue({ ok: true })
export const reservationViewUrl = vi.fn((id: string, anonId: string | null) =>
  `https://sunbnb.app/reservations/${id}${anonId ? `?anonId=${anonId}` : ''}`)
export const confirmationHtml = vi.fn().mockReturnValue('<html></html>')
