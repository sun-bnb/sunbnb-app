import { describe, expect, it, vi } from 'vitest'
import { pollExtract, toExtractStatus, type ExtractStatus } from './aerial-api'

const seq = (...s: ExtractStatus[]) => {
  const post = vi.fn<() => Promise<ExtractStatus>>()
  s.forEach((v) => post.mockResolvedValueOnce(v))
  return post
}

describe('pollExtract', () => {
  it('returns as soon as the server says done, without sleeping', async () => {
    const sleep = vi.fn(async () => {})
    expect(await pollExtract({ post: seq('done'), sleep })).toBe('done')
    expect(sleep).not.toHaveBeenCalled()
  })
  it('re-POSTs while running, then settles', async () => {
    const post = seq('running', 'running', 'done')
    const sleep = vi.fn(async () => {})
    expect(await pollExtract({ post, sleep, intervalMs: 5 })).toBe('done')
    expect(post).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(5)
  })
  it('does not retry a failure (the user retries explicitly)', async () => {
    const post = seq('failed')
    expect(await pollExtract({ post, sleep: async () => {} })).toBe('failed')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('gives up as failed after maxAttempts of running', async () => {
    const post = vi.fn(async () => 'running' as const)
    expect(await pollExtract({ post, sleep: async () => {}, maxAttempts: 4 })).toBe('failed')
    expect(post).toHaveBeenCalledTimes(4)
  })
  it('stops silently (null) when cancelled, even if the in-flight POST resolves done', async () => {
    let cancelled = false
    const post = vi.fn(async () => {
      cancelled = true
      return 'done' as const
    })
    expect(await pollExtract({ post, sleep: async () => {}, isCancelled: () => cancelled })).toBeNull()
  })
})

describe('toExtractStatus', () => {
  it('treats anything unknown as failed', () => {
    expect(toExtractStatus('running')).toBe('running')
    expect(toExtractStatus('weird')).toBe('failed')
    expect(toExtractStatus(undefined)).toBe('failed')
  })
})
