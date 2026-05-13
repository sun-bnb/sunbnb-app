import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

import {
  createLayoutElement,
  updateLayoutElement,
  deleteLayoutElement,
  reorderLayoutElements,
} from './actions'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

const mockRequireSiteOwner = vi.mocked(requireSiteOwner)
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireSiteOwner.mockResolvedValue({ session: null, error: 'Not authenticated' })
})

function authorize() {
  mockRequireSiteOwner.mockResolvedValue({ session: { user: { id: 'owner-1' } }, error: null })
}

// ─── createLayoutElement ───────────────────────────────────────────────────

describe('createLayoutElement', () => {
  const validInput = {
    type: 'water',
    shape: 'rect' as const,
    x: 5,
    y: 5,
    width: 10,
    height: 8,
  }

  it('rejects unauthenticated', async () => {
    const res = await createLayoutElement(SITE_ID, validInput)
    expect(res.status).toBe('error')
  })

  it('rejects invalid shape', async () => {
    authorize()
    const res = await createLayoutElement(SITE_ID, { ...validInput, shape: 'hex' as any })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid shape')
  })

  it('rejects negative width', async () => {
    authorize()
    const res = await createLayoutElement(SITE_ID, { ...validInput, width: -1 })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid width')
  })

  it('rejects empty type', async () => {
    authorize()
    const res = await createLayoutElement(SITE_ID, { ...validInput, type: '' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid type')
  })

  it('creates element with defaults for rotation/z/label/color', async () => {
    authorize()
    vi.mocked(prisma.layoutElement.create).mockResolvedValue({ id: 'el-1' } as any)
    const res = await createLayoutElement(SITE_ID, validInput)
    expect(res.status).toBe('ok')
    const args = vi.mocked(prisma.layoutElement.create).mock.calls[0][0]
    expect(args.data.rotation).toBe(0)
    // Action defaults z to 100 (not the schema default of 0) so newly-placed
    // elements float above existing ones in the same zBand.
    expect(args.data.z).toBe(100)
    expect(args.data.label).toBeNull()
    expect(args.data.color).toBeNull()
    expect(args.data.siteId).toBe(SITE_ID)
  })
})

// ─── updateLayoutElement ───────────────────────────────────────────────────

describe('updateLayoutElement', () => {
  it('returns Not found when element missing', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue(null)
    const res = await updateLayoutElement('missing', { x: 1, y: 2 })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not found')
  })

  it('rejects when caller does not own the site', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    const res = await updateLayoutElement('el-1', { x: 1, y: 2 })
    expect(res.status).toBe('error')
  })

  it('updates allowed fields when authorized', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    authorize()
    vi.mocked(prisma.layoutElement.update).mockResolvedValue({} as any)
    const res = await updateLayoutElement('el-1', { x: 3, y: 4, label: 'Cabana 1' })
    expect(res.status).toBe('ok')
    const args = vi.mocked(prisma.layoutElement.update).mock.calls[0][0]
    expect(args.where).toEqual({ id: 'el-1' })
    expect(args.data).toMatchObject({ x: 3, y: 4, label: 'Cabana 1' })
  })

  it('rejects out-of-range rotation', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    authorize()
    const res = await updateLayoutElement('el-1', { rotation: 9999 })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid rotation')
  })
})

// ─── deleteLayoutElement ───────────────────────────────────────────────────

describe('deleteLayoutElement', () => {
  it('returns Not found when missing', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue(null)
    const res = await deleteLayoutElement('missing')
    expect(res.status).toBe('error')
  })

  it('rejects unauthorized caller', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    const res = await deleteLayoutElement('el-1')
    expect(res.status).toBe('error')
  })

  it('deletes when authorized', async () => {
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    authorize()
    vi.mocked(prisma.layoutElement.delete).mockResolvedValue({} as any)
    const res = await deleteLayoutElement('el-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.layoutElement.delete)).toHaveBeenCalledWith({ where: { id: 'el-1' } })
  })
})

// ─── reorderLayoutElements ─────────────────────────────────────────────────

describe('reorderLayoutElements', () => {
  it('rejects unauthorized', async () => {
    const res = await reorderLayoutElements(SITE_ID, [{ id: 'a', z: 1 }])
    expect(res.status).toBe('error')
  })

  it('rejects non-integer z values', async () => {
    authorize()
    const res = await reorderLayoutElements(SITE_ID, [{ id: 'a', z: 1.5 }])
    expect(res.status).toBe('error')
  })

  it('rejects when an element is not on the site', async () => {
    authorize()
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([{ id: 'a' }] as any)
    const res = await reorderLayoutElements(SITE_ID, [
      { id: 'a', z: 1 },
      { id: 'b', z: 2 },
    ])
    expect(res.status).toBe('error')
  })

  it('updates z values transactionally when all owned', async () => {
    authorize()
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any)
    vi.mocked(prisma.layoutElement.update).mockResolvedValue({} as any)
    const res = await reorderLayoutElements(SITE_ID, [
      { id: 'a', z: 3 },
      { id: 'b', z: 4 },
    ])
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled()
  })
})
