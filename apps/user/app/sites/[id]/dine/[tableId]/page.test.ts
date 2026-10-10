import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/navigation.redirect throws (Next's control-flow signal) — capture the target.
const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

import LegacyDinePage from './page'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('legacy /sites/[id]/dine/[tableId] alias', () => {
  it('redirects to /tables/[tableId] with no query params', async () => {
    await LegacyDinePage({
      params: Promise.resolve({ id: 'site-1', tableId: 'table-1' }),
      searchParams: Promise.resolve({}),
    })

    expect(mockRedirect).toHaveBeenCalledWith('/tables/table-1')
  })

  it('preserves query params (e.g. mid-flight Mollie return ?tabReturn=)', async () => {
    await LegacyDinePage({
      params: Promise.resolve({ id: 'site-1', tableId: 'table-1' }),
      searchParams: Promise.resolve({ tabReturn: 'tab-abc123' }),
    })

    expect(mockRedirect).toHaveBeenCalledWith('/tables/table-1?tabReturn=tab-abc123')
  })

  it('preserves multiple query params', async () => {
    await LegacyDinePage({
      params: Promise.resolve({ id: 'site-1', tableId: 'table-1' }),
      searchParams: Promise.resolve({ tabReturn: 'tab-abc123', foo: 'bar' }),
    })

    const calledWith = mockRedirect.mock.calls[0][0] as string
    const url = new URL(calledWith, 'http://localhost')
    expect(url.pathname).toBe('/tables/table-1')
    expect(url.searchParams.get('tabReturn')).toBe('tab-abc123')
    expect(url.searchParams.get('foo')).toBe('bar')
  })

  it('ignores undefined searchParams values', async () => {
    await LegacyDinePage({
      params: Promise.resolve({ id: 'site-1', tableId: 'table-1' }),
      searchParams: Promise.resolve({ tabReturn: undefined }),
    })

    expect(mockRedirect).toHaveBeenCalledWith('/tables/table-1')
  })

  it('supports array-valued query params (repeated keys)', async () => {
    await LegacyDinePage({
      params: Promise.resolve({ id: 'site-1', tableId: 'table-1' }),
      searchParams: Promise.resolve({ tag: ['a', 'b'] }),
    })

    const calledWith = mockRedirect.mock.calls[0][0] as string
    const url = new URL(calledWith, 'http://localhost')
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b'])
  })

  it('routes on the tableId param, independent of the legacy siteId', async () => {
    await LegacyDinePage({
      params: Promise.resolve({ id: 'some-other-site', tableId: 'table-9' }),
      searchParams: Promise.resolve({}),
    })

    expect(mockRedirect).toHaveBeenCalledWith('/tables/table-9')
  })
})
