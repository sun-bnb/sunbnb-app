/**
 * Preferences actions — the sudo gate and the pass-through to the registry.
 *
 * Deliberately thin on validation: bounds and parsing belong to
 * `@repo/data/preferences` and are tested there. What must hold HERE is that no
 * non-sudo caller can change a platform-wide value, and that the action does not
 * grow its own opinion about which keys exist or what they accept.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@repo/data/preferences', () => ({
  getPreferenceAdminRows: vi.fn(),
  setPreference: vi.fn(),
  isPreferenceKey: (key: string) => key === 'device-poll-interval-sec',
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { listPreferences, savePreference, resetPreference } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getPreferenceAdminRows, setPreference } from '@repo/data/preferences'

const mockAuth = vi.mocked(auth)
const mockGetRows = vi.mocked(getPreferenceAdminRows)
const mockSet = vi.mocked(setPreference)

const KEY = 'device-poll-interval-sec'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockSet.mockResolvedValue({ status: 'ok' } as never)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
}

function authenticateAsNonSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
}

describe('sudo gate', () => {
  it('rejects an unauthenticated caller on every action', async () => {
    await expect(listPreferences()).rejects.toThrow('Not authenticated')
    await expect(savePreference(KEY, '120')).rejects.toThrow('Not authenticated')
    await expect(resetPreference(KEY)).rejects.toThrow('Not authenticated')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects a signed-in non-sudo user on every action', async () => {
    authenticateAsNonSudo()
    await expect(listPreferences()).rejects.toThrow('sudo required')
    await expect(savePreference(KEY, '120')).rejects.toThrow('sudo required')
    await expect(resetPreference(KEY)).rejects.toThrow('sudo required')
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe('listPreferences', () => {
  it('returns the registry rows for a sudo user', async () => {
    authenticateAsSudo()
    mockGetRows.mockResolvedValue([{ key: KEY }] as never)
    await expect(listPreferences()).resolves.toEqual([{ key: KEY }])
  })
})

describe('savePreference', () => {
  it('passes the raw value and the acting admin id straight through', async () => {
    authenticateAsSudo()
    const result = await savePreference(KEY, '120')
    expect(result).toEqual({ status: 'ok' })
    expect(mockSet).toHaveBeenCalledWith(KEY, '120', 'admin-1')
  })

  it('surfaces a registry rejection rather than swallowing it', async () => {
    authenticateAsSudo()
    mockSet.mockResolvedValue({
      status: 'error',
      errors: ['Device poll interval must be between 10 and 3600 seconds'],
    } as never)
    const result = await savePreference(KEY, '2')
    expect(result).toEqual({
      status: 'error',
      errors: ['Device poll interval must be between 10 and 3600 seconds'],
    })
  })

  it('refuses an unregistered key without touching the store', async () => {
    authenticateAsSudo()
    const result = await savePreference('made-up-key', '1')
    expect(result.status).toBe('error')
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe('resetPreference', () => {
  it('clears the override by writing null', async () => {
    authenticateAsSudo()
    const result = await resetPreference(KEY)
    expect(result).toEqual({ status: 'ok' })
    expect(mockSet).toHaveBeenCalledWith(KEY, null)
  })

  it('refuses an unregistered key', async () => {
    authenticateAsSudo()
    const result = await resetPreference('made-up-key')
    expect(result.status).toBe('error')
    expect(mockSet).not.toHaveBeenCalled()
  })
})
