import { vi } from 'vitest'

export const rateLimit = vi.fn().mockReturnValue({ allowed: true })
