/**
 * Platform preferences — unit tests.
 *
 * The load-bearing property here is that a BAD stored value can never reach a
 * consumer: an out-of-range poll interval written by a direct SQL edit, or left
 * behind by an older release with wider bounds, would otherwise be handed to a
 * potted device that obeys it for the rest of the season. Every "rejects" case
 * below asserts the fall-through to the shipped default, not just the rejection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const findMany = vi.fn()
const findUnique = vi.fn()
const upsert = vi.fn()
const deleteMany = vi.fn()

vi.mock('../index', () => ({
  default: {
    platformPreference: {
      findMany: (...args: unknown[]) => findMany(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}))

import {
  PREFERENCE_REGISTRY,
  envVarForPreference,
  isPreferenceKey,
  parsePreferenceValue,
  validatePreferenceValue,
  resolvePreference,
  getPreference,
  getPreferenceCached,
  clearPreferenceCache,
  setPreference,
  getPreferenceAdminRows,
  getPreferences,
  type PreferenceDefinition,
} from './preferences'

const POLL = PREFERENCE_REGISTRY['device-poll-interval-sec'] as PreferenceDefinition
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  findMany.mockReset()
  findUnique.mockReset()
  upsert.mockReset()
  deleteMany.mockReset()
  findMany.mockResolvedValue([])
  findUnique.mockResolvedValue(null)
  clearPreferenceCache()
  delete process.env.PREF_DEVICE_POLL_INTERVAL_SEC
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('registry', () => {
  it('keys the poll interval at the value the firmware was written against', () => {
    // The default is the constant the HW state route used to hardcode. If this
    // ever changes, every device on a DB with no override changes cadence.
    expect(POLL.type).toBe('number')
    expect(POLL.default).toBe(60)
  })

  it('has a key matching its registry index (the DB primary key)', () => {
    for (const [index, def] of Object.entries(PREFERENCE_REGISTRY)) {
      expect((def as PreferenceDefinition).key).toBe(index)
    }
  })

  it('recognises only registered keys', () => {
    expect(isPreferenceKey('device-poll-interval-sec')).toBe(true)
    expect(isPreferenceKey('device-poll-interval')).toBe(false)
  })
})

describe('envVarForPreference', () => {
  it('uppercases and replaces hyphens', () => {
    expect(envVarForPreference('device-poll-interval-sec')).toBe(
      'PREF_DEVICE_POLL_INTERVAL_SEC',
    )
  })
})

describe('parsePreferenceValue', () => {
  it('parses an in-range number', () => {
    expect(parsePreferenceValue(POLL, '120')).toBe(120)
    expect(parsePreferenceValue(POLL, ' 30 ')).toBe(30)
  })

  it('refuses a number outside the registry bounds', () => {
    expect(parsePreferenceValue(POLL, '9')).toBeUndefined()
    expect(parsePreferenceValue(POLL, '3601')).toBeUndefined()
  })

  it('refuses what is not a number at all', () => {
    for (const raw of ['', '   ', 'soon', '60s', 'NaN', 'Infinity']) {
      expect(parsePreferenceValue(POLL, raw)).toBeUndefined()
    }
  })

  it('treats null/undefined as no opinion', () => {
    expect(parsePreferenceValue(POLL, null)).toBeUndefined()
    expect(parsePreferenceValue(POLL, undefined)).toBeUndefined()
  })

  it('parses booleans and strings by definition type', () => {
    const bool = { key: 'b', type: 'boolean', label: 'B', group: 'g', description: '', default: false } as PreferenceDefinition
    const str = { key: 's', type: 'string', label: 'S', group: 'g', description: '', default: '', maxLength: 4 } as PreferenceDefinition
    for (const v of ['1', 'true', 'ON', 'yes']) expect(parsePreferenceValue(bool, v)).toBe(true)
    for (const v of ['0', 'false', 'OFF', 'no']) expect(parsePreferenceValue(bool, v)).toBe(false)
    expect(parsePreferenceValue(bool, 'maybe')).toBeUndefined()
    expect(parsePreferenceValue(str, 'abcd')).toBe('abcd')
    expect(parsePreferenceValue(str, 'abcde')).toBeUndefined()
  })
})

describe('validatePreferenceValue', () => {
  it('accepts an in-range value', () => {
    expect(validatePreferenceValue(POLL, '90')).toEqual({ ok: true, value: 90 })
  })

  it('distinguishes "not a number" from "out of range" in the message', () => {
    const nan = validatePreferenceValue(POLL, 'often')
    const range = validatePreferenceValue(POLL, '5')
    expect(nan).toEqual({ ok: false, error: expect.stringContaining('must be a number') })
    expect(range).toEqual({ ok: false, error: expect.stringContaining('between 10 and 3600') })
  })
})

describe('resolvePreference', () => {
  it('falls back to the registry default with no row and no env', () => {
    expect(resolvePreference(POLL, null)).toEqual({ value: 60, source: 'default' })
  })

  it('uses the DB row when present', () => {
    expect(resolvePreference(POLL, '120')).toEqual({ value: 120, source: 'db' })
  })

  it('lets an env var beat the DB row — the recovery path without DB access', () => {
    process.env.PREF_DEVICE_POLL_INTERVAL_SEC = '30'
    expect(resolvePreference(POLL, '120')).toEqual({ value: 30, source: 'env' })
  })

  it('ignores an out-of-range DB row rather than serving it', () => {
    expect(resolvePreference(POLL, '1')).toEqual({ value: 60, source: 'default' })
    expect(resolvePreference(POLL, '86400')).toEqual({ value: 60, source: 'default' })
  })

  it('ignores an out-of-range env var and still honours a valid DB row', () => {
    process.env.PREF_DEVICE_POLL_INTERVAL_SEC = '0'
    expect(resolvePreference(POLL, '120')).toEqual({ value: 120, source: 'db' })
  })
})

describe('getPreference', () => {
  it('reads the row by primary key', async () => {
    findUnique.mockResolvedValue({ value: '150' })
    await expect(getPreference('device-poll-interval-sec')).resolves.toBe(150)
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: 'device-poll-interval-sec' },
      select: { value: true },
    })
  })

  it('falls back to the default when the table is missing or the query throws', async () => {
    findUnique.mockRejectedValue(new Error('relation "platform_preference" does not exist'))
    await expect(getPreference('device-poll-interval-sec')).resolves.toBe(60)
  })
})

describe('getPreferenceCached', () => {
  it('reads once within the TTL and again after it', async () => {
    findUnique.mockResolvedValue({ value: '120' })
    await getPreferenceCached('device-poll-interval-sec', 60_000)
    await getPreferenceCached('device-poll-interval-sec', 60_000)
    expect(findUnique).toHaveBeenCalledTimes(1)

    // Same call with a zero TTL is always a miss.
    await getPreferenceCached('device-poll-interval-sec', 0)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('is invalidated by a write, so the admin sees their own change', async () => {
    findUnique.mockResolvedValue({ value: '120' })
    await expect(getPreferenceCached('device-poll-interval-sec')).resolves.toBe(120)

    await setPreference('device-poll-interval-sec', '30', 'admin-1')
    findUnique.mockResolvedValue({ value: '30' })
    await expect(getPreferenceCached('device-poll-interval-sec')).resolves.toBe(30)
  })
})

describe('setPreference', () => {
  it('upserts a valid value with the admin id', async () => {
    const result = await setPreference('device-poll-interval-sec', '300', 'admin-1')
    expect(result).toEqual({ status: 'ok' })
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'device-poll-interval-sec' },
      create: { key: 'device-poll-interval-sec', value: '300', updatedBy: 'admin-1' },
      update: { value: '300', updatedBy: 'admin-1' },
    })
  })

  it('refuses an out-of-range value and writes nothing', async () => {
    const result = await setPreference('device-poll-interval-sec', '2', 'admin-1')
    expect(result.status).toBe('error')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('deletes the row on null, restoring env/default', async () => {
    const result = await setPreference('device-poll-interval-sec', null)
    expect(result).toEqual({ status: 'ok' })
    expect(deleteMany).toHaveBeenCalledWith({ where: { key: 'device-poll-interval-sec' } })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown key without touching the DB', async () => {
    const result = await setPreference('nope' as never, '1')
    expect(result.status).toBe('error')
    expect(upsert).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })
})

describe('getPreferenceAdminRows', () => {
  it('reports the default when nothing is set', async () => {
    const [row] = await getPreferenceAdminRows()
    expect(row).toMatchObject({
      key: 'device-poll-interval-sec',
      type: 'number',
      min: 10,
      max: 3600,
      default: 60,
      dbValue: null,
      envValue: null,
      resolved: 60,
      source: 'default',
    })
  })

  it('surfaces the stored row, who set it, and when', async () => {
    const at = new Date('2026-08-18T10:00:00Z')
    findMany.mockResolvedValue([
      { key: 'device-poll-interval-sec', value: '120', updatedAt: at, updatedBy: 'admin-1' },
    ])
    const [row] = await getPreferenceAdminRows()
    expect(row).toMatchObject({
      dbValue: '120',
      resolved: 120,
      source: 'db',
      updatedAt: at,
      updatedBy: 'admin-1',
    })
  })

  it('shows the env override winning over the stored row, so the admin knows why their number is not in effect', async () => {
    process.env.PREF_DEVICE_POLL_INTERVAL_SEC = '45'
    findMany.mockResolvedValue([
      { key: 'device-poll-interval-sec', value: '120', updatedAt: new Date(), updatedBy: null },
    ])
    const [row] = await getPreferenceAdminRows()
    expect(row).toMatchObject({ dbValue: '120', envValue: '45', resolved: 45, source: 'env' })
  })

  it('does not report an env var the registry rejects as an override in effect', async () => {
    process.env.PREF_DEVICE_POLL_INTERVAL_SEC = '1'
    const [row] = await getPreferenceAdminRows()
    expect(row.envValue).toBeNull()
    expect(row.resolved).toBe(60)
  })

  it('survives a missing table', async () => {
    findMany.mockRejectedValue(new Error('relation "platform_preference" does not exist'))
    const [row] = await getPreferenceAdminRows()
    expect(row.resolved).toBe(60)
  })
})

describe('getPreferences', () => {
  it('resolves every registry key in one query', async () => {
    findMany.mockResolvedValue([{ key: 'device-poll-interval-sec', value: '90' }])
    await expect(getPreferences()).resolves.toEqual({ 'device-poll-interval-sec': 90 })
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})
