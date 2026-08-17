/**
 * The claim-not-authority rule (track 021) against real Postgres.
 *
 * This endpoint has no authentication, so a device's assertion about its
 * customer must be able to CREATE something out of nothing but must never
 * RE-POINT something that already exists. These tests exist because the
 * difference is the whole security boundary.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import prisma from '../index'
import { cleanDatabase } from './test/setup'
import { applyDeviceClaim } from './device-claim'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect() })

async function partner(code: string, email: string) {
  const user = await prisma.user.create({ data: { email, name: 'P' } })
  await prisma.partnerAccount.create({
    data: {
      userId: user.id, code,
      firstName: 'A', lastName: 'B', email, phoneNumber: '1', company: 'C', address: 'D',
    },
  })
  return user
}

describe('applyDeviceClaim', () => {
  it('self-registers an UNKNOWN device to the claimed customer', async () => {
    const owner = await partner('P-4KQ9M', 'owner@test.local')

    expect(await applyDeviceClaim('NWJMDB', 'P-4KQ9M')).toBe('registered')

    const device = await prisma.device.findUniqueOrThrow({ where: { code: 'NWJMDB' } })
    expect(device.partnerAccountId).toBe(owner.id)
    // Provisioned, not active: it exists and is talking, but nobody has
    // installed or verified it.
    expect(device.status).toBe('provisioned')
  })

  it('accepts the claim in any spelling a label might be read in', async () => {
    await partner('P-4KQ9M', 'owner@test.local')
    expect(await applyDeviceClaim('NWJMDB', 'p4kq9m')).toBe('registered')
  })

  it('NEVER re-points an existing device — it records the claim instead', async () => {
    const owner = await partner('P-4KQ9M', 'owner@test.local')
    await partner('P-7ZZZZ', 'stranger@test.local')
    await prisma.device.create({
      data: { code: 'NWJMDB', status: 'active', partnerAccountId: owner.id },
    })

    expect(await applyDeviceClaim('NWJMDB', 'P-7ZZZZ')).toBe('mismatch-recorded')

    const device = await prisma.device.findUniqueOrThrow({ where: { code: 'NWJMDB' } })
    // THE security boundary: ownership is unchanged, and the disagreement is
    // visible for a human to resolve.
    expect(device.partnerAccountId).toBe(owner.id)
    expect(device.claimedPartnerCode).toBe('P-7ZZZZ')
  })

  it('clears a recorded mismatch once the claim agrees again', async () => {
    const owner = await partner('P-4KQ9M', 'owner@test.local')
    await prisma.device.create({
      data: {
        code: 'NWJMDB', status: 'active', partnerAccountId: owner.id,
        claimedPartnerCode: 'P-7ZZZZ',
      },
    })

    expect(await applyDeviceClaim('NWJMDB', 'P-4KQ9M')).toBe('matches')
    const device = await prisma.device.findUniqueOrThrow({ where: { code: 'NWJMDB' } })
    expect(device.claimedPartnerCode).toBeNull()
  })

  it('creates nothing for an unknown partner code — a mis-flash or a stranger', async () => {
    expect(await applyDeviceClaim('NWJMDB', 'P-ZZZZZ')).toBe('unknown-partner')
    expect(await prisma.device.count()).toBe(0)
  })

  it('creates nothing for a malformed claim, and nothing for no claim at all', async () => {
    expect(await applyDeviceClaim('NWJMDB', 'garbage')).toBe('invalid-claim')
    expect(await applyDeviceClaim('NWJMDB', null)).toBe('no-claim')
    expect(await prisma.device.count()).toBe(0)
  })
})
