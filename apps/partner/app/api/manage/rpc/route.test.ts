import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the allowlist entirely so this test file never pulls in the real
// manage/actions.ts import chain (prisma, till, payment, etc.) — the route's
// only job is to validate shape and forward, which a fake handler proves.
const { mockOk, mockThrows } = vi.hoisted(() => ({
  mockOk: vi.fn(),
  mockThrows: vi.fn(),
}))

vi.mock('./registry', () => ({
  RPC_ACTIONS: {
    ping: mockOk,
    boom: mockThrows,
  },
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/manage/rpc', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/manage/rpc', () => {
  it('rejects a non-object body', async () => {
    const response = await POST(makeRequest('"just a string"') as any)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.status).toBe('error')
  })

  it('rejects invalid JSON', async () => {
    const request = new Request('http://localhost/api/manage/rpc', {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    })
    const response = await POST(request as any)
    expect(response.status).toBe(400)
  })

  it('rejects a missing/non-string action', async () => {
    const response = await POST(makeRequest({ args: [] }) as any)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors[0]).toMatch(/action/i)
  })

  it('rejects a non-array args', async () => {
    const response = await POST(makeRequest({ action: 'ping', args: 'nope' }) as any)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors[0]).toMatch(/args/i)
  })

  it('rejects args longer than 20 elements', async () => {
    const response = await POST(
      makeRequest({ action: 'ping', args: new Array(21).fill(0) }) as any,
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors[0]).toMatch(/20/)
  })

  it('rejects an action not in the allowlist', async () => {
    const response = await POST(makeRequest({ action: 'deleteEverything', args: [] }) as any)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors[0]).toMatch(/Unknown action/)
  })

  it('forwards the call to the registered handler with spread args and returns 200', async () => {
    mockOk.mockResolvedValue({ status: 'ok', value: 42 })

    const response = await POST(
      makeRequest({ action: 'ping', args: ['site-1', 'item-1', 'key-abc'] }) as any,
    )

    expect(mockOk).toHaveBeenCalledWith('site-1', 'item-1', 'key-abc')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ status: 'ok', value: 42 })
  })

  it('normalises a thrown error into { status: error, errors: [message] }', async () => {
    mockThrows.mockRejectedValue(new Error('boom happened'))

    const response = await POST(makeRequest({ action: 'boom', args: [] }) as any)
    const data = await response.json()

    expect(data).toEqual({ status: 'error', errors: ['boom happened'] })
  })

  it('normalises a non-Error throw via String()', async () => {
    mockThrows.mockRejectedValue('a plain string throw')

    const response = await POST(makeRequest({ action: 'boom', args: [] }) as any)
    const data = await response.json()

    expect(data).toEqual({ status: 'error', errors: ['a plain string throw'] })
  })
})
