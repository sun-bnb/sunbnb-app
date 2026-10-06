import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@repo/data/leads', () => ({ setLeadStatus: vi.fn() }))

import { updateLeadStatus } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { setLeadStatus } from '@repo/data/leads'
import { revalidatePath } from 'next/cache'

const mockAuth = vi.mocked(auth)
const mockSet = vi.mocked(setLeadStatus)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
}

describe('updateLeadStatus', () => {
  it('rejects unauthenticated callers without touching the lead', async () => {
    await expect(updateLeadStatus('l1', 'contacted')).rejects.toThrow('Not authenticated')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects non-sudo users without touching the lead', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
    await expect(updateLeadStatus('l1', 'contacted')).rejects.toThrow('sudo required')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('returns an error for an invalid status and does not write', async () => {
    authenticateAsSudo()
    for (const bad of ['bogus', 'mockup', '']) {
      const res = await updateLeadStatus('l1', bad)
      expect(res.status).toBe('error')
      expect(res.errors?.length).toBeGreaterThan(0)
    }
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('sets the status and revalidates on the ok path', async () => {
    authenticateAsSudo()
    mockSet.mockResolvedValue(true)
    await expect(updateLeadStatus('l1', 'converted')).resolves.toEqual({ status: 'ok' })
    expect(mockSet).toHaveBeenCalledWith('l1', 'converted')
    expect(revalidatePath).toHaveBeenCalledWith('/leads')
    expect(revalidatePath).toHaveBeenCalledWith('/leads/l1')
  })

  it('returns an error when the lead does not exist', async () => {
    authenticateAsSudo()
    mockSet.mockResolvedValue(false)
    const res = await updateLeadStatus('ghost', 'closed')
    expect(res.status).toBe('error')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
