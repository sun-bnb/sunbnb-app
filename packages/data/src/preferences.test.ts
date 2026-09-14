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
const transaction = vi.fn()

vi.mock('../index', () => ({
  default: {
    platformPreference: {
      findMany: (...args: unknown[]) => findMany(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}))

import {
  PREFERENCE_REGISTRY,
  getDevicePowerMode,
  envVarForPreference,
  isPreferenceKey,
  parsePreferenceValue,
  validatePreferenceValue,
  resolvePreference,
  getPreference,
  getPreferenceCached,
  clearPreferenceCache,
  setPreference,
  getPlatformDevicePolicy,
  setDevicePolicy,
  resetDevicePolicy,
  getPreferenceAdminRows,
  getPreferences,
  type PreferenceDefinition,
} from './preferences'
import { clampPollInterval } from './device-power'

const POLL = PREFERENCE_REGISTRY['device-poll-interval-sec'] as PreferenceDefinition
const MODE = PREFERENCE_REGISTRY['device-power-mode'] as PreferenceDefinition
const ORIGINAL_ENV = { ...process.env }

/** Admin rows are keyed, not ordered — a new registry entry must not shift them. */
async function adminRow(key: string) {
  const rows = await getPreferenceAdminRows()
  const row = rows.find((r) => r.key === key)
  if (!row) throw new Error(`no admin row for ${key}`)
  return row
}

beforeEach(() => {
  findMany.mockReset()
  findUnique.mockReset()
  upsert.mockReset()
  deleteMany.mockReset()
  transaction.mockReset()
  // The paired write goes through $transaction; the mock just runs the operations
  // it was handed, so the assertions below can read them as upsert calls.
  transaction.mockImplementation((ops: unknown) => Promise.all(ops as Promise<unknown>[]))
  findMany.mockResolvedValue([])
  findUnique.mockResolvedValue(null)
  clearPreferenceCache()
  delete process.env.PREF_DEVICE_POLL_INTERVAL_SEC
  delete process.env.PREF_DEVICE_POWER_MODE
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
    expect(isPreferenceKey('device-power-mode')).toBe(true)
  })

  it('bounds the poll interval by the UNION of the mode bands, not by one mode', () => {
    // The stored value has to be able to hold any mode's cadence; the ACTIVE
    // mode narrows it further on the write path and on the way out.
    expect(POLL).toMatchObject({ min: 1, max: 300 })
  })

  it('defaults to deep sleep at 60 s — the cadence the fleet already runs', () => {
    // Introducing modes must not change what a device does today. 60 s sits
    // inside the deep-sleep band, so an un-configured platform serves exactly
    // what it served before the mode existed.
    expect(MODE.default).toBe('deep_sleep')
    expect(POLL.default).toBe(60)
    expect(clampPollInterval('deep_sleep', 60)).toBe(60)
  })

  it('offers every power mode as a choice, wire id first', () => {
    expect(MODE.type).toBe('enum')
    expect((MODE as { options: readonly { value: string }[] }).options.map((o) => o.value)).toEqual([
      'continuous',
      'light_sleep',
      'deep_sleep',
    ])
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
    expect(parsePreferenceValue(POLL, '0')).toBeUndefined()
    expect(parsePreferenceValue(POLL, '301')).toBeUndefined()
  })

  it('parses an enum by wire id, folding case and separators', () => {
    // An operator reads "Light sleep" off the screen; the wire carries the id.
    for (const raw of ['light_sleep', 'LIGHT_SLEEP', 'Light Sleep', 'light-sleep']) {
      expect(parsePreferenceValue(MODE, raw)).toBe('light_sleep')
    }
    expect(parsePreferenceValue(MODE, 'hibernate')).toBeUndefined()
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
    const range = validatePreferenceValue(POLL, '900')
    expect(nan).toEqual({ ok: false, error: expect.stringContaining('must be a number') })
    expect(range).toEqual({ ok: false, error: expect.stringContaining('between 1 and 300') })
  })

  it('names the legal choices when an enum value is not one of them', () => {
    const bad = validatePreferenceValue(MODE, 'hibernate')
    expect(bad).toEqual({ ok: false, error: expect.stringContaining('continuous, light_sleep, deep_sleep') })
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
    expect(resolvePreference(POLL, '0')).toEqual({ value: 60, source: 'default' })
    expect(resolvePreference(POLL, '86400')).toEqual({ value: 60, source: 'default' })
  })

  it('ignores an out-of-range env var and still honours a valid DB row', () => {
    process.env.PREF_DEVICE_POLL_INTERVAL_SEC = '0'
    expect(resolvePreference(POLL, '120')).toEqual({ value: 120, source: 'db' })
  })

  it('ignores an unknown power mode rather than serving it to the fleet', () => {
    expect(resolvePreference(MODE, 'hibernate')).toEqual({ value: 'deep_sleep', source: 'default' })
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

  describe('the power-mode band on the poll interval', () => {
    it('refuses an interval the ACTIVE mode cannot keep, and says which mode', async () => {
      // 5 s is a legal interval in the registry (continuous can serve it) but
      // deep sleep pays a full Wi-Fi join per wake and has a floor near 30 s.
      // Refused rather than clamped: quietly serving a cadence nobody chose is
      // how a fleet ends up running something nobody chose.
      findUnique.mockResolvedValue(null) // no mode row → deep_sleep default
      const result = await setPreference('device-poll-interval-sec', '5', 'admin-1')
      expect(result.status).toBe('error')
      expect((result as { errors: string[] }).errors[0]).toContain('Deep sleep')
      expect((result as { errors: string[] }).errors[0]).toContain('30–300')
      expect(upsert).not.toHaveBeenCalled()
    })

    it('accepts that same interval once the mode that CAN keep it is active', async () => {
      findUnique.mockResolvedValue({ value: 'continuous' })
      const result = await setPreference('device-poll-interval-sec', '5', 'admin-1')
      expect(result).toEqual({ status: 'ok' })
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'device-poll-interval-sec' } }),
      )
    })

    it('re-fits a now-illegal interval when the mode changes, rather than leaving a lie', async () => {
      // Stored 60 s under deep sleep; light sleep tops out at 45 s. The admin
      // page must not keep showing 60 while the fleet is served 45.
      findUnique.mockResolvedValue({ value: '60' })
      const result = await setPreference('device-power-mode', 'light_sleep', 'admin-1')
      expect(result).toEqual({ status: 'ok' })
      expect(upsert).toHaveBeenCalledWith({
        where: { key: 'device-power-mode' },
        create: { key: 'device-power-mode', value: 'light_sleep', updatedBy: 'admin-1' },
        update: { value: 'light_sleep', updatedBy: 'admin-1' },
      })
      expect(upsert).toHaveBeenCalledWith({
        where: { key: 'device-poll-interval-sec' },
        create: { key: 'device-poll-interval-sec', value: '45', updatedBy: 'admin-1' },
        update: { value: '45', updatedBy: 'admin-1' },
      })
    })

    it('leaves an interval alone when the new mode can already keep it', async () => {
      findUnique.mockResolvedValue({ value: '12' })
      await setPreference('device-power-mode', 'continuous', 'admin-1')
      const keys = upsert.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key)
      expect(keys).toEqual(['device-power-mode'])
    })

    it('re-fits after a mode RESET too — the default band binds like any other', async () => {
      // Reset from continuous back to the deep-sleep default, with a 5 s
      // interval that only continuous could serve.
      findUnique.mockResolvedValue({ value: '5' })
      await setPreference('device-power-mode', null, 'admin-1')
      expect(deleteMany).toHaveBeenCalledWith({ where: { key: 'device-power-mode' } })
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'device-poll-interval-sec' },
          update: { value: '30', updatedBy: 'admin-1' },
        }),
      )
    })
  })
})

describe('setDevicePolicy — the mode and its cadence written as one', () => {
  it('writes both keys in ONE transaction when the pair is legal', async () => {
    const result = await setDevicePolicy('light_sleep', '20', 'admin-1')
    expect(result).toEqual({ status: 'ok' })
    expect(transaction).toHaveBeenCalledTimes(1)
    const keys = upsert.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key)
    expect(keys).toEqual(['device-power-mode', 'device-poll-interval-sec'])
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'device-poll-interval-sec' },
      create: { key: 'device-poll-interval-sec', value: '20', updatedBy: 'admin-1' },
      update: { value: '20', updatedBy: 'admin-1' },
    })
  })

  it('REFUSES the pair a mode change invalidates — no silent re-fit on this path', async () => {
    // The difference from setPreference(MODE): the admin can see both values, so a
    // cadence the new mode cannot keep is an error to correct, not a number to
    // quietly replace. 60 s is deep-sleep-only.
    const result = await setDevicePolicy('continuous', '60', 'admin-1')
    expect(result.status).toBe('error')
    expect((result as { errors: string[] }).errors[0]).toContain('Continuous')
    expect((result as { errors: string[] }).errors[0]).toContain('1–15 seconds')
    expect(upsert).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('validates the interval against the mode BEING SAVED, not the stored one', async () => {
    // Stored mode is continuous; saving deep_sleep + 120 s must pass even though
    // 120 s is illegal under what is in the DB right now.
    findUnique.mockResolvedValue({ value: 'continuous' })
    await expect(setDevicePolicy('deep_sleep', '120', 'admin-1')).resolves.toEqual({
      status: 'ok',
    })
  })

  it('refuses an unknown mode and an unusable interval, writing nothing', async () => {
    for (const [mode, interval] of [
      ['hibernate', '20'],
      ['light_sleep', 'soon'],
      ['light_sleep', ''],
      ['light_sleep', '900'],
    ]) {
      const result = await setDevicePolicy(mode, interval, 'admin-1')
      expect(result.status).toBe('error')
    }
    expect(upsert).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('accepts a label-shaped mode the way the registry parses one', async () => {
    await expect(setDevicePolicy('Light Sleep', '20')).resolves.toEqual({ status: 'ok' })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: 'light_sleep', updatedBy: null } }),
    )
  })

  it('invalidates the cache, so the admin re-reads their own change', async () => {
    findUnique.mockResolvedValue({ value: '120' })
    await expect(getPreferenceCached('device-poll-interval-sec')).resolves.toBe(120)
    await setDevicePolicy('light_sleep', '20', 'admin-1')
    findUnique.mockResolvedValue({ value: '20' })
    await expect(getPreferenceCached('device-poll-interval-sec')).resolves.toBe(20)
  })
})

describe('getPlatformDevicePolicy', () => {
  it('returns the pair RAW — resolution and clamping belong to one place', async () => {
    // Deliberately not resolved here: the caller feeds these to
    // `resolveDevicePolicyForDevice` together with the device's own override, so
    // the clamp happens once, in the pure module, instead of twice with a chance
    // of disagreeing.
    findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'device-power-mode' ? { value: 'light_sleep' } : { value: '20' },
    )
    await expect(getPlatformDevicePolicy()).resolves.toEqual({
      mode: 'light_sleep',
      intervalSec: 20,
    })
  })

  it('reads through the CACHE — this is on the poll route hot path', async () => {
    findUnique.mockResolvedValue({ value: '120' })
    await getPlatformDevicePolicy()
    const firstCallCount = findUnique.mock.calls.length
    await getPlatformDevicePolicy()
    expect(findUnique.mock.calls.length).toBe(firstCallCount)
  })

  it('falls back to the registry defaults when nothing is stored', async () => {
    findUnique.mockResolvedValue(null)
    await expect(getPlatformDevicePolicy()).resolves.toEqual({
      mode: 'deep_sleep',
      intervalSec: 60,
    })
  })
})

describe('resetDevicePolicy', () => {
  it('drops BOTH overrides together, never one of the pair', async () => {
    // Clearing only the mode could leave a stored interval outside the default
    // mode's band — legal for the reader, which clamps, but a lie on screen.
    await expect(resetDevicePolicy()).resolves.toEqual({ status: 'ok' })
    expect(deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['device-power-mode', 'device-poll-interval-sec'] } },
    })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('getDevicePowerMode', () => {
  it('reads the stored mode', async () => {
    findUnique.mockResolvedValue({ value: 'continuous' })
    await expect(getDevicePowerMode()).resolves.toBe('continuous')
  })

  it('falls back to deep sleep — the SAFE mode, not the fast one', async () => {
    // A device polling every second on a misread value empties its cell in days.
    findUnique.mockResolvedValue({ value: 'hibernate' })
    await expect(getDevicePowerMode()).resolves.toBe('deep_sleep')
  })
})

describe('getPreferenceAdminRows', () => {
  it('reports the default when nothing is set', async () => {
    const row = await adminRow('device-poll-interval-sec')
    expect(row).toMatchObject({
      key: 'device-poll-interval-sec',
      type: 'number',
      min: 1,
      max: 300,
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
    const row = await adminRow('device-poll-interval-sec')
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
    const row = await adminRow('device-poll-interval-sec')
    expect(row).toMatchObject({ dbValue: '120', envValue: '45', resolved: 45, source: 'env' })
  })

  it('does not report an env var the registry rejects as an override in effect', async () => {
    process.env.PREF_DEVICE_POLL_INTERVAL_SEC = '0'
    const row = await adminRow('device-poll-interval-sec')
    expect(row.envValue).toBeNull()
    expect(row.resolved).toBe(60)
  })

  it('survives a missing table', async () => {
    findMany.mockRejectedValue(new Error('relation "platform_preference" does not exist'))
    const row = await adminRow('device-poll-interval-sec')
    expect(row.resolved).toBe(60)
  })

  it('carries the enum choices for the mode row', async () => {
    const row = await adminRow('device-power-mode')
    expect(row).toMatchObject({ type: 'enum', default: 'deep_sleep', resolved: 'deep_sleep' })
    expect(row.options?.map((o) => o.value)).toEqual(['continuous', 'light_sleep', 'deep_sleep'])
    expect(row.min).toBeNull()
  })

  it('reports the interval a DEVICE would get, not the stored one, when the band moved it', async () => {
    // The one place an operator goes to find out what the fleet is doing must
    // not show 60 s while every device is being served 45.
    findMany.mockResolvedValue([
      { key: 'device-power-mode', value: 'light_sleep', updatedAt: new Date(), updatedBy: null },
      { key: 'device-poll-interval-sec', value: '60', updatedAt: new Date(), updatedBy: null },
    ])
    const row = await adminRow('device-poll-interval-sec')
    expect(row.dbValue).toBe('60')
    expect(row.resolved).toBe(45)
  })
})

describe('getPreferences', () => {
  it('resolves every registry key in one query', async () => {
    findMany.mockResolvedValue([{ key: 'device-poll-interval-sec', value: '90' }])
    await expect(getPreferences()).resolves.toEqual({
      'device-poll-interval-sec': 90,
      'device-power-mode': 'deep_sleep',
    })
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})
