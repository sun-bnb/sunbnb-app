import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth before any imports that transitively use it.
vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { getEmployees, createEmployee, renameEmployee, setEmployeeActive, deleteEmployee } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

const OWNER_ID = 'user-owner-1'
const OTHER_USER_ID = 'user-other-2'
const EMP_ID = 'emp-abc-123'

beforeEach(() => {
  vi.clearAllMocks()
  // Always reset to null — clearAllMocks clears call history but not
  // implementations; auth leaks between tests if not reset here.
  mockAuth.mockResolvedValue(null)
})

// ─── getEmployees ─────────────────────────────────────────────────────────────

describe('getEmployees', () => {
  it('throws when unauthenticated', async () => {
    await expect(getEmployees()).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.employee.findMany)).not.toHaveBeenCalled()
  })

  it('returns only employees belonging to the session account', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const ownEmployee = { id: EMP_ID, accountId: OWNER_ID, name: 'Alice', active: true }
    vi.mocked(prisma.employee.findMany).mockResolvedValue([ownEmployee] as any)

    const result = await getEmployees()

    expect(vi.mocked(prisma.employee.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId: OWNER_ID }),
      })
    )
    expect(result).toEqual([ownEmployee])
  })

  it('scopes query to the session user id, not a hardcoded value', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)

    await getEmployees()

    const callArgs = vi.mocked(prisma.employee.findMany).mock.calls[0]![0] as any
    expect(callArgs.where.accountId).toBe(OTHER_USER_ID)
    expect(callArgs.where.accountId).not.toBe(OWNER_ID)
  })

  it('orders results active-first then alphabetically by name', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)

    await getEmployees()

    const callArgs = vi.mocked(prisma.employee.findMany).mock.calls[0]![0] as any
    expect(callArgs.orderBy).toEqual([{ active: 'desc' }, { name: 'asc' }])
  })
})

// ─── createEmployee ───────────────────────────────────────────────────────────

describe('createEmployee', () => {
  it('throws when unauthenticated', async () => {
    await expect(createEmployee('Alice')).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.employee.create)).not.toHaveBeenCalled()
  })

  it('returns error for empty name', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const result = await createEmployee('  ')

    expect(result.status).toBe('error')
    expect((result as any).errors).toHaveLength(1)
    expect(vi.mocked(prisma.employee.create)).not.toHaveBeenCalled()
  })

  it('returns error for name exceeding 80 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const longName = 'A'.repeat(81)
    const result = await createEmployee(longName)

    expect(result.status).toBe('error')
    expect((result as any).errors).toHaveLength(1)
    expect(vi.mocked(prisma.employee.create)).not.toHaveBeenCalled()
  })

  it('name at exactly 80 characters is accepted', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.create).mockResolvedValue({} as any)

    const name80 = 'A'.repeat(80)
    const result = await createEmployee(name80)

    expect(result.status).toBe('ok')
    expect(vi.mocked(prisma.employee.create)).toHaveBeenCalled()
  })

  it('creates employee scoped to session user accountId', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.create).mockResolvedValue({} as any)

    await createEmployee('Alice')

    const callArgs = vi.mocked(prisma.employee.create).mock.calls[0]![0] as any
    expect(callArgs.data.accountId).toBe(OWNER_ID)
  })

  it('creates employee with active: true by default', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.create).mockResolvedValue({} as any)

    await createEmployee('Alice')

    const callArgs = vi.mocked(prisma.employee.create).mock.calls[0]![0] as any
    expect(callArgs.data.active).toBe(true)
  })

  it('trims whitespace from name before creating', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.create).mockResolvedValue({} as any)

    await createEmployee('  Alice  ')

    const callArgs = vi.mocked(prisma.employee.create).mock.calls[0]![0] as any
    expect(callArgs.data.name).toBe('Alice')
  })

  it('returns { status: "ok" } on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.create).mockResolvedValue({} as any)

    const result = await createEmployee('Alice')

    expect(result).toEqual({ status: 'ok' })
  })
})

// ─── renameEmployee ───────────────────────────────────────────────────────────

describe('renameEmployee', () => {
  it('throws when unauthenticated', async () => {
    await expect(renameEmployee(EMP_ID, 'Bob')).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.employee.updateMany)).not.toHaveBeenCalled()
  })

  it('returns error for empty name', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const result = await renameEmployee(EMP_ID, '')

    expect(result.status).toBe('error')
    expect(vi.mocked(prisma.employee.updateMany)).not.toHaveBeenCalled()
  })

  it('returns error for name exceeding 80 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const result = await renameEmployee(EMP_ID, 'B'.repeat(81))

    expect(result.status).toBe('error')
    expect(vi.mocked(prisma.employee.updateMany)).not.toHaveBeenCalled()
  })

  it('updates using compound where { id, accountId } — prevents cross-account rename', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 1 })

    await renameEmployee(EMP_ID, 'Bob')

    expect(vi.mocked(prisma.employee.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EMP_ID, accountId: OWNER_ID },
      })
    )
  })

  it('uses session user id in where clause, not a hardcoded value', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 1 })

    await renameEmployee(EMP_ID, 'Bob')

    const callArgs = vi.mocked(prisma.employee.updateMany).mock.calls[0]![0] as any
    expect(callArgs.where.accountId).toBe(OTHER_USER_ID)
    expect(callArgs.where.accountId).not.toBe(OWNER_ID)
  })

  it('returns error when employee not found (count 0 means no-match)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 0 })

    const result = await renameEmployee(EMP_ID, 'Bob')

    expect(result.status).toBe('error')
  })

  it('returns { status: "ok" } on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 1 })

    const result = await renameEmployee(EMP_ID, 'Bob')

    expect(result).toEqual({ status: 'ok' })
  })
})

// ─── setEmployeeActive ────────────────────────────────────────────────────────

describe('setEmployeeActive', () => {
  it('throws when unauthenticated', async () => {
    await expect(setEmployeeActive(EMP_ID, false)).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.employee.updateMany)).not.toHaveBeenCalled()
  })

  it('updates active state with compound where { id, accountId }', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 1 })

    await setEmployeeActive(EMP_ID, false)

    expect(vi.mocked(prisma.employee.updateMany)).toHaveBeenCalledWith({
      where: { id: EMP_ID, accountId: OWNER_ID },
      data: { active: false },
    })
  })

  it('can reactivate an inactive employee', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 1 })

    await setEmployeeActive(EMP_ID, true)

    const callArgs = vi.mocked(prisma.employee.updateMany).mock.calls[0]![0] as any
    expect(callArgs.data.active).toBe(true)
  })

  it('uses the session user id, not a hardcoded one', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 0 })

    await setEmployeeActive(EMP_ID, false)

    const callArgs = vi.mocked(prisma.employee.updateMany).mock.calls[0]![0] as any
    expect(callArgs.where.accountId).toBe(OTHER_USER_ID)
  })

  it('returns { status: "ok" }', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.updateMany).mockResolvedValue({ count: 1 })

    const result = await setEmployeeActive(EMP_ID, false)

    expect(result).toEqual({ status: 'ok' })
  })
})

// ─── deleteEmployee ───────────────────────────────────────────────────────────

describe('deleteEmployee', () => {
  it('throws when unauthenticated', async () => {
    await expect(deleteEmployee(EMP_ID)).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.employee.deleteMany)).not.toHaveBeenCalled()
  })

  it('deletes using compound where { id, accountId } — prevents cross-account deletion', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.deleteMany).mockResolvedValue({ count: 1 })

    await deleteEmployee(EMP_ID)

    expect(vi.mocked(prisma.employee.deleteMany)).toHaveBeenCalledWith({
      where: { id: EMP_ID, accountId: OWNER_ID },
    })
  })

  it('uses the session user id, not a hardcoded one', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.employee.deleteMany).mockResolvedValue({ count: 0 })

    await deleteEmployee(EMP_ID)

    const callArgs = vi.mocked(prisma.employee.deleteMany).mock.calls[0]![0] as any
    expect(callArgs.where.accountId).toBe(OTHER_USER_ID)
    expect(callArgs.where.accountId).not.toBe(OWNER_ID)
  })

  it('returns { status: "ok" } on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.employee.deleteMany).mockResolvedValue({ count: 1 })

    const result = await deleteEmployee(EMP_ID)

    expect(result).toEqual({ status: 'ok' })
  })
})
