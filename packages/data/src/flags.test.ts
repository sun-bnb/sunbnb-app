import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const findMany = vi.fn()
const upsert = vi.fn()
const deleteMany = vi.fn()

vi.mock('../index', () => ({
  default: {
    featureFlag: {
      findMany: (...args: unknown[]) => findMany(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}))

import {
  FLAG_REGISTRY,
  currentFlagEnvironment,
  envVarForFlag,
  readEnvOverride,
  defaultForEnvironment,
  resolveFlag,
  getFlagStates,
  isFlagEnabled,
  setFlagOverride,
  getFlagAdminRows,
} from './flags'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  findMany.mockReset()
  upsert.mockReset()
  deleteMany.mockReset()
  findMany.mockResolvedValue([])
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('envVarForFlag', () => {
  it('uppercases and replaces hyphens', () => {
    expect(envVarForFlag('restaurants')).toBe('FF_RESTAURANTS')
    expect(envVarForFlag('new-checkout-flow')).toBe('FF_NEW_CHECKOUT_FLOW')
  })
})

describe('readEnvOverride', () => {
  it('returns true for truthy strings', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'yes']) {
      process.env.FF_RESTAURANTS = v
      expect(readEnvOverride('restaurants')).toBe(true)
    }
  })

  it('returns false for falsy strings', () => {
    for (const v of ['0', 'false', 'FALSE', 'off', 'no']) {
      process.env.FF_RESTAURANTS = v
      expect(readEnvOverride('restaurants')).toBe(false)
    }
  })

  it('returns undefined when the var is missing or unrecognized', () => {
    delete process.env.FF_RESTAURANTS
    expect(readEnvOverride('restaurants')).toBeUndefined()

    process.env.FF_RESTAURANTS = 'maybe'
    expect(readEnvOverride('restaurants')).toBeUndefined()
  })
})

describe('currentFlagEnvironment', () => {
  it('prefers VERCEL_ENV', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.NODE_ENV = 'development'
    expect(currentFlagEnvironment()).toBe('production')
  })

  it('falls back to NODE_ENV when VERCEL_ENV is unset', () => {
    delete process.env.VERCEL_ENV
    process.env.NODE_ENV = 'test'
    expect(currentFlagEnvironment()).toBe('test')
  })

  it('defaults to development', () => {
    delete process.env.VERCEL_ENV
    delete process.env.NODE_ENV
    expect(currentFlagEnvironment()).toBe('development')
  })
})

describe('defaultForEnvironment', () => {
  const def = {
    name: 'x',
    description: '',
    defaults: { development: true, preview: false, test: false, production: false },
  }

  it('returns the requested environment default', () => {
    expect(defaultForEnvironment(def, 'development')).toBe(true)
    expect(defaultForEnvironment(def, 'production')).toBe(false)
  })
})

describe('resolveFlag — precedence', () => {
  const def = {
    name: 'restaurants',
    description: '',
    defaults: { development: false, preview: false, test: false, production: false },
  }

  beforeEach(() => {
    delete process.env.FF_RESTAURANTS
  })

  it('sudo bypass wins over everything', () => {
    process.env.FF_RESTAURANTS = 'false'
    expect(resolveFlag(def, { isSudo: true, dbOverride: false })).toEqual({
      name: 'restaurants',
      enabled: true,
      source: 'sudo',
    })
  })

  it('env override wins over db and default', () => {
    process.env.FF_RESTAURANTS = 'true'
    expect(
      resolveFlag(def, { dbOverride: false, environment: 'production' }),
    ).toEqual({ name: 'restaurants', enabled: true, source: 'env' })
  })

  it('db override wins over default', () => {
    expect(
      resolveFlag(def, { dbOverride: true, environment: 'production' }),
    ).toEqual({ name: 'restaurants', enabled: true, source: 'db' })
  })

  it('falls back to environment default', () => {
    const d2 = { ...def, defaults: { ...def.defaults, production: true } }
    expect(resolveFlag(d2, { environment: 'production' })).toEqual({
      name: 'restaurants',
      enabled: true,
      source: 'default',
    })
  })
})

describe('getFlagStates', () => {
  it('returns a state for every registered flag', async () => {
    findMany.mockResolvedValue([])
    const states = await getFlagStates()
    for (const name of Object.keys(FLAG_REGISTRY)) {
      expect(states).toHaveProperty(name)
      expect(states[name as keyof typeof FLAG_REGISTRY].source).toBe('default')
    }
  })

  it('applies db overrides', async () => {
    findMany.mockResolvedValue([{ name: 'restaurants', enabled: true }])
    process.env.VERCEL_ENV = 'production'
    delete process.env.FF_RESTAURANTS
    const states = await getFlagStates()
    expect(states.restaurants).toEqual({
      name: 'restaurants',
      enabled: true,
      source: 'db',
    })
  })

  it('returns sudo source when isSudo is true', async () => {
    process.env.VERCEL_ENV = 'production'
    findMany.mockResolvedValue([])
    const states = await getFlagStates({ isSudo: true })
    expect(states.restaurants).toEqual({
      name: 'restaurants',
      enabled: true,
      source: 'sudo',
    })
  })

  it('falls back gracefully when the DB query throws', async () => {
    findMany.mockRejectedValue(new Error('table missing'))
    const states = await getFlagStates()
    expect(states.restaurants.source).toBe('default')
  })
})

describe('isFlagEnabled', () => {
  it('returns the resolved boolean', async () => {
    findMany.mockResolvedValue([{ name: 'restaurants', enabled: true }])
    expect(await isFlagEnabled('restaurants')).toBe(true)
  })
})

describe('setFlagOverride', () => {
  it('upserts with adminUserId', async () => {
    await setFlagOverride('restaurants', true, 'admin-1')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'restaurants' },
        create: expect.objectContaining({
          name: 'restaurants',
          enabled: true,
          updatedBy: 'admin-1',
        }),
        update: expect.objectContaining({ enabled: true, updatedBy: 'admin-1' }),
      }),
    )
  })

  it('deletes the row when enabled is null (clears override)', async () => {
    await setFlagOverride('restaurants', null)
    expect(deleteMany).toHaveBeenCalledWith({ where: { name: 'restaurants' } })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects unknown flag names', async () => {
    await expect(
      setFlagOverride('does-not-exist' as never, true),
    ).rejects.toThrow(/Unknown flag/)
  })
})

describe('getFlagAdminRows', () => {
  it('exposes envOverride, dbOverride, resolved state, and source per flag', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.FF_RESTAURANTS = 'true'
    findMany.mockResolvedValue([
      {
        name: 'restaurants',
        enabled: false,
        updatedAt: new Date('2026-05-01'),
        updatedBy: 'admin-1',
      },
    ])

    const rows = await getFlagAdminRows()
    const restaurants = rows.find((r) => r.name === 'restaurants')!
    expect(restaurants.envOverride).toBe(true)
    expect(restaurants.dbOverride).toBe(false)
    // env wins over db, so resolved should be true with source 'env'
    expect(restaurants.resolved).toBe(true)
    expect(restaurants.source).toBe('env')
    expect(restaurants.updatedBy).toBe('admin-1')
  })
})
