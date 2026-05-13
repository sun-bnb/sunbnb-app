import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@repo/data/flags', () => ({
  getFlagAdminRows: vi.fn(),
  setFlagOverride: vi.fn(),
  FLAG_REGISTRY: {
    restaurants: {
      name: 'restaurants',
      description: 'test flag',
      defaults: { development: true, preview: true, test: false, production: false },
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { listFlags, setFlag, clearFlag } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getFlagAdminRows, setFlagOverride } from '@repo/data/flags'

const mockAuth = vi.mocked(auth)
const mockGetRows = vi.mocked(getFlagAdminRows)
const mockSet = vi.mocked(setFlagOverride)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
}

function authenticateAsNonSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
}

describe('listFlags', () => {
  it('rejects unauthenticated users', async () => {
    await expect(listFlags()).rejects.toThrow('Not authenticated')
  })

  it('rejects non-sudo users', async () => {
    authenticateAsNonSudo()
    await expect(listFlags()).rejects.toThrow('sudo required')
  })

  it('returns flag rows for sudo users', async () => {
    authenticateAsSudo()
    mockGetRows.mockResolvedValue([
      { name: 'restaurants' } as never,
    ])
    const rows = await listFlags()
    expect(rows).toHaveLength(1)
    expect(mockGetRows).toHaveBeenCalledOnce()
  })
})

describe('setFlag', () => {
  it('rejects unauthenticated users', async () => {
    await expect(setFlag('restaurants', true)).rejects.toThrow('Not authenticated')
  })

  it('rejects non-sudo users', async () => {
    authenticateAsNonSudo()
    await expect(setFlag('restaurants', true)).rejects.toThrow('sudo required')
  })

  it('rejects unknown flag names', async () => {
    authenticateAsSudo()
    const result = await setFlag('does-not-exist', true)
    expect(result.status).toBe('error')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('upserts the override with admin user id and returns ok', async () => {
    authenticateAsSudo()
    mockSet.mockResolvedValue(undefined)
    const result = await setFlag('restaurants', true)
    expect(result.status).toBe('ok')
    expect(mockSet).toHaveBeenCalledWith('restaurants', true, 'admin-1')
  })
})

describe('clearFlag', () => {
  it('rejects non-sudo users', async () => {
    authenticateAsNonSudo()
    await expect(clearFlag('restaurants')).rejects.toThrow('sudo required')
  })

  it('rejects unknown flags', async () => {
    authenticateAsSudo()
    const result = await clearFlag('does-not-exist')
    expect(result.status).toBe('error')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('passes null to clear the DB override', async () => {
    authenticateAsSudo()
    mockSet.mockResolvedValue(undefined)
    const result = await clearFlag('restaurants')
    expect(result.status).toBe('ok')
    expect(mockSet).toHaveBeenCalledWith('restaurants', null)
  })
})
