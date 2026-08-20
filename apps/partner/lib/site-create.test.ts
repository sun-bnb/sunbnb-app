/**
 * Track 022 — every site must be created WITH its QR code.
 *
 * The failure this guards against is quiet and physical: a site created without
 * a code cannot have cards printed for it, and nobody notices until someone
 * stands at the printer. The retry rules matter for the same reason — a mint
 * that gives up, or one that swallows an unrelated constraint violation, both
 * end as "site creation failed" with the wrong cause attached.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import prisma from '@repo/data/PrismaCient'
import { createSiteWithCode } from './site-create'
import { isValidSiteCode, SITE_CODE_PREFIX } from '@repo/data/site-code'

const create = vi.mocked(prisma.site.create)

/** A Prisma unique-violation, shaped the way the client actually throws one. */
function uniqueViolation(target: string[]) {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target },
  })
}

const DATA = { name: 'Playa Nueva', locationLat: '36.5', locationLng: '-4.9' } as never

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ id: 'site-1' } as never)
})

describe('createSiteWithCode', () => {
  it('mints a valid prefixed code onto the created site', async () => {
    await createSiteWithCode(DATA)

    expect(create).toHaveBeenCalledTimes(1)
    const code = create.mock.calls[0]![0]!.data.code as string
    expect(code.startsWith(SITE_CODE_PREFIX)).toBe(true)
    expect(isValidSiteCode(code)).toBe(true)
  })

  it("passes the caller's data through untouched", async () => {
    await createSiteWithCode(DATA)

    expect(create.mock.calls[0]![0]!.data).toMatchObject({
      name: 'Playa Nueva',
      locationLat: '36.5',
      locationLng: '-4.9',
    })
  })

  it('returns what prisma returns, so callers keep their id', async () => {
    create.mockResolvedValue({ id: 'site-xyz' } as never)
    await expect(createSiteWithCode(DATA)).resolves.toEqual({ id: 'site-xyz' })
  })

  it('retries a code collision with a DIFFERENT code', async () => {
    // Retrying with the same code would collide forever — the mint has to be
    // inside the loop, which is exactly what this asserts.
    create.mockRejectedValueOnce(uniqueViolation(['code']))

    await createSiteWithCode(DATA)

    expect(create).toHaveBeenCalledTimes(2)
    const first = create.mock.calls[0]![0]!.data.code
    const second = create.mock.calls[1]![0]!.data.code
    expect(second).not.toBe(first)
    expect(isValidSiteCode(second as string)).toBe(true)
  })

  it('does NOT retry a different unique violation — it surfaces it at once', async () => {
    // A restaurantId clash is the caller's problem, not a minting problem.
    // Retrying it five times would hide the real cause behind four wasted
    // inserts and report it late.
    const err = uniqueViolation(['restaurantId'])
    create.mockRejectedValue(err)

    await expect(createSiteWithCode(DATA)).rejects.toBe(err)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt budget rather than looping forever', async () => {
    const err = uniqueViolation(['code'])
    create.mockRejectedValue(err)

    await expect(createSiteWithCode(DATA)).rejects.toBe(err)
    expect(create).toHaveBeenCalledTimes(5)
  })

  it('never retries a failure that is not a unique violation at all', async () => {
    const err = new Error('connection terminated')
    create.mockRejectedValue(err)

    await expect(createSiteWithCode(DATA)).rejects.toBe(err)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
