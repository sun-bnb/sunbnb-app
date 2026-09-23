/**
 * Telemetry retention sweep — unit tests.
 *
 * Two properties carry the weight, and neither is about the happy path:
 *
 *   - **The sweep is BOUNDED.** It runs in a serverless invocation against a
 *     table that is very large exactly when someone has just shortened the
 *     window. An unbounded delete that times out halfway is the worst case,
 *     because the next run would start over.
 *   - **It deletes by AGE, oldest first, and never touches anything inside the
 *     window.** This is the one operation in the system that destroys data no
 *     backfill can reconstruct.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeRaw = vi.fn()

vi.mock('../index', () => ({
  default: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}))

const getPreference = vi.fn()
vi.mock('./preferences', () => ({
  getPreference: (...args: unknown[]) => getPreference(...args),
}))

import { pruneDeviceTelemetry, PRUNE_CHUNK_ROWS, PRUNE_MAX_ROWS } from './device-telemetry'

const NOW = new Date('2026-09-23T03:20:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  getPreference.mockResolvedValue(365)
})

describe('pruneDeviceTelemetry', () => {
  it('computes the cutoff from the retention preference, not a constant', () => {
    // The whole point of the preference is that the operator owns this number.
    getPreference.mockResolvedValue(30)
    executeRaw.mockResolvedValue(0)
    return pruneDeviceTelemetry(NOW).then((result) => {
      expect(getPreference).toHaveBeenCalledWith('device-telemetry-retention-days')
      expect(result.retentionDays).toBe(30)
      expect(result.cutoff).toEqual(new Date(NOW.getTime() - 30 * DAY_MS))
    })
  })

  it('reports the default window when nothing overrides it', async () => {
    executeRaw.mockResolvedValue(0)
    const result = await pruneDeviceTelemetry(NOW)
    expect(result.cutoff).toEqual(new Date(NOW.getTime() - 365 * DAY_MS))
  })

  it('stops after a short chunk — that is how it knows it is finished', async () => {
    executeRaw.mockResolvedValueOnce(PRUNE_CHUNK_ROWS).mockResolvedValueOnce(120)
    const result = await pruneDeviceTelemetry(NOW)
    expect(executeRaw).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ deleted: PRUNE_CHUNK_ROWS + 120, complete: true })
  })

  it('does nothing, and says so, when nothing is past the cutoff', async () => {
    executeRaw.mockResolvedValue(0)
    const result = await pruneDeviceTelemetry(NOW)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ deleted: 0, complete: true })
  })

  it('is idempotent — a second run over a swept window deletes nothing', async () => {
    executeRaw.mockResolvedValueOnce(400)
    await pruneDeviceTelemetry(NOW)
    executeRaw.mockResolvedValue(0)
    const second = await pruneDeviceTelemetry(NOW)
    expect(second).toMatchObject({ deleted: 0, complete: true })
  })

  it('STOPS at the per-run ceiling and reports itself incomplete', async () => {
    // The first sweep after someone cuts retention from a year to a week must
    // not run for minutes. Whatever it finished is committed; the rest goes
    // with tomorrow's run, and a day of over-retained rows is unobservable.
    executeRaw.mockResolvedValue(PRUNE_CHUNK_ROWS)
    const result = await pruneDeviceTelemetry(NOW)
    expect(result.complete).toBe(false)
    expect(result.deleted).toBeGreaterThanOrEqual(PRUNE_MAX_ROWS)
    // Bounded work, not "until the table is empty".
    expect(executeRaw).toHaveBeenCalledTimes(PRUNE_MAX_ROWS / PRUNE_CHUNK_ROWS)
  })

  it('parameterises the cutoff rather than interpolating it into SQL', async () => {
    executeRaw.mockResolvedValue(0)
    await pruneDeviceTelemetry(NOW)
    // A tagged-template call: strings array first, then the bound values. The
    // cutoff must arrive as a PARAMETER — this is a raw DELETE, and the one
    // place a formatting mistake would be both silent and destructive.
    const [strings, ...values] = executeRaw.mock.calls[0]!
    expect(Array.isArray(strings)).toBe(true)
    expect(values).toContainEqual(new Date(NOW.getTime() - 365 * DAY_MS))
    expect((strings as string[]).join('?')).toContain('DELETE FROM device_telemetry')
  })
})
