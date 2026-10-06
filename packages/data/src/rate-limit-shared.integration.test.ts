/**
 * The shared limiter against real Postgres: it must count across "instances" (concurrent calls
 * share one row), start over in the next window, and its pruning must delete only dead windows.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import prisma from '../index'
import { cleanDatabase } from './test/setup'
import { pruneRateLimitCounters, rateLimitShared } from './rate-limit-shared'

beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect() })

const limit = { maxAttempts: 10, windowMs: 60_000 }
const t0 = new Date(Date.UTC(2026, 9, 6, 10, 0, 5))

describe('rateLimitShared', () => {
  it('lets exactly maxAttempts through when 25 requests race', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => rateLimitShared('chat:198.51.100.1', limit, t0)))
    expect(results.filter((r) => r.allowed)).toHaveLength(10)
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })

  it('counts keys separately', async () => {
    for (let i = 0; i < 10; i++) await rateLimitShared('chat:198.51.100.1', limit, t0)
    expect((await rateLimitShared('chat:198.51.100.1', limit, t0)).allowed).toBe(false)
    expect((await rateLimitShared('chat:198.51.100.2', limit, t0)).allowed).toBe(true)
  })

  it('starts over in the next window', async () => {
    for (let i = 0; i < 11; i++) await rateLimitShared('k', limit, t0)
    const next = await rateLimitShared('k', limit, new Date(t0.getTime() + 60_000))
    expect(next).toEqual({ allowed: true, count: 1 })
  })

  it('stores no raw subject', async () => {
    await rateLimitShared('demo:203.0.113.7', limit, t0)
    const rows = await prisma.rateLimitCounter.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.key).not.toContain('203.0.113.7')
  })
})

describe('pruneRateLimitCounters', () => {
  it('deletes ended windows and keeps the current one', async () => {
    await rateLimitShared('old', limit, t0)
    await rateLimitShared('current', limit, new Date(t0.getTime() + 120_000))
    expect(await pruneRateLimitCounters(new Date(t0.getTime() + 125_000))).toBe(1)
    expect(await prisma.rateLimitCounter.count()).toBe(1)
  })
})
