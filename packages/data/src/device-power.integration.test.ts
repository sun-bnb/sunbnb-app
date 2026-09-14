/**
 * The per-device power policy is a PAIR, enforced by the database (track 025).
 *
 * Integration rather than unit tests because the property under test is the
 * `device_power_policy_pair_chk` constraint itself — the one thing no amount of
 * mocking can assert. The application already refuses a half-set pair in two
 * places (the partner action validates before writing, and
 * `resolveDevicePolicyForDevice` treats a half pair as "inherit"), so this is
 * the third line: a restore, an older release or a hand-run UPDATE cannot leave
 * a device carrying half a policy.
 *
 * Note what is deliberately NOT constrained: the mode string and the poll
 * bands. Those are code-owned policy that has already moved once (light sleep's
 * ceiling), and a CHECK on them would turn a band change into a contract
 * migration.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('device_power_policy_pair_chk', () => {
  it('accepts a device with no override at all', async () => {
    const device = await prisma.device.create({ data: { code: 'NWJMDB', status: 'active' } })
    expect(device.powerMode).toBeNull()
    expect(device.pollIntervalSec).toBeNull()
  })

  it('accepts a complete override', async () => {
    const device = await prisma.device.create({
      data: { code: 'NWJMDC', status: 'active', powerMode: 'light_sleep', pollIntervalSec: 20 },
    })
    expect(device).toMatchObject({ powerMode: 'light_sleep', pollIntervalSec: 20 })
  })

  it('REFUSES half a policy, in both directions', async () => {
    await expect(
      prisma.device.create({
        data: { code: 'NWJMDD', status: 'active', powerMode: 'light_sleep' },
      }),
    ).rejects.toThrow()

    await expect(
      prisma.device.create({
        data: { code: 'NWJMDE', status: 'active', pollIntervalSec: 20 },
      }),
    ).rejects.toThrow()
  })

  it('REFUSES an update that would strip one half of an existing pair', async () => {
    // The likelier accident than a bad insert: clearing the override by nulling
    // one column, which would leave the device on a policy nobody set.
    await prisma.device.create({
      data: { code: 'NWJMDF', status: 'active', powerMode: 'deep_sleep', pollIntervalSec: 120 },
    })
    await expect(
      prisma.device.update({ where: { code: 'NWJMDF' }, data: { powerMode: null } }),
    ).rejects.toThrow()

    // Clearing BOTH is how an override is removed, and it is allowed.
    const cleared = await prisma.device.update({
      where: { code: 'NWJMDF' },
      data: { powerMode: null, pollIntervalSec: null },
    })
    expect(cleared.powerMode).toBeNull()
    expect(cleared.pollIntervalSec).toBeNull()
  })

  it('does NOT police the values — a band is code policy, not a schema contract', async () => {
    // 900 s is outside every band. The DB stores it; the resolver clamps it on
    // the way out. Constraining this would make a future band change a
    // migration, and would reject a row that today's code may legitimately mean.
    const device = await prisma.device.create({
      data: { code: 'NWJMDG', status: 'active', powerMode: 'deep_sleep', pollIntervalSec: 900 },
    })
    expect(device.pollIntervalSec).toBe(900)
  })
})
