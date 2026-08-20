/**
 * QR entry resolution (track 022).
 *
 * The URL under test is printed on a card and glued to a lounger, so the
 * failures worth guarding are the ones that would send a guest to the WRONG bed
 * or to a dead page with no way to tell why:
 *
 *  - the compound key must carry all four parts — `seq` repeats in every row, so
 *    dropping `row` silently resolves a neighbouring row's unit;
 *  - the code must be folded exactly as it was minted, or a lowercase hand-typed
 *    URL misses a site that is right there;
 *  - a malformed URL must cost a regex, not a query;
 *  - anything unresolvable must decline, never offer an empty unit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import prisma from '@repo/data/PrismaCient'
import { resolveQrTarget } from './resolve'

const findSite = vi.mocked(prisma.site.findUnique)
const findUnit = vi.mocked(prisma.sunbedGroup.findUnique)

const SITE = { id: 'site-1', code: 'S-K7M2X9', name: 'Brisa Marina' }
const SEATS = [
  { id: 'seat-a', number: 10101, status: 'active' },
  { id: 'seat-b', number: 10102, status: 'active' },
]

beforeEach(() => {
  vi.clearAllMocks()
  findSite.mockResolvedValue(SITE as never)
  findUnit.mockResolvedValue({ id: 'unit-1', items: SEATS } as never)
})

describe('resolveQrTarget', () => {
  it('resolves a scanned card to its site and the beds standing there', async () => {
    const result = await resolveQrTarget('S-K7M2X9', '1-1-1')

    expect(result).toEqual({ site: SITE, items: SEATS })
  })

  it('queries the unit by the FULL four-part address', async () => {
    // `seq` restarts in every row, so a key missing `row` resolves to a unit in
    // a different row of the same parcel — a guest sent to someone else's bed,
    // with nothing in the response to suggest anything went wrong.
    await resolveQrTarget('S-K7M2X9', '2-3-4')

    expect(findUnit.mock.calls[0]![0]!.where).toEqual({
      siteId_parcel_row_seq: { siteId: 'site-1', parcel: 2, row: 3, seq: 4 },
    })
  })

  it('folds the site code the way it was minted', async () => {
    // A card read aloud and typed into a phone arrives lowercase and often
    // without the prefix. Looking that up verbatim finds nothing.
    await resolveQrTarget('k7m2x9', '1-1-1')

    expect(findSite.mock.calls[0]![0]!.where).toEqual({ code: 'S-K7M2X9' })
  })

  it('resolves the four-segment seat id to the same unit', async () => {
    // `1-1-1-2` is what formatSeatId prints under the QR. The member names a bed
    // inside the unit; the page renders the whole unit either way.
    await resolveQrTarget('S-K7M2X9', '1-1-1-2')

    expect(findUnit.mock.calls[0]![0]!.where).toEqual({
      siteId_parcel_row_seq: { siteId: 'site-1', parcel: 1, row: 1, seq: 1 },
    })
  })

  it('excludes pool spares and orders the beds deterministically', async () => {
    // Two reasons. A spare parked on a unit is not a bed under that parasol, and
    // surfacing one makes the whole unit read "Reserved" forever (a pool seat is
    // never in the availability set). And with the scanned seat gone from the
    // URL, nothing else fixes the order the beds are drawn in.
    await resolveQrTarget('S-K7M2X9', '1-1-1')

    expect(findUnit.mock.calls[0]![0]!.include.items).toEqual({
      where: { status: { not: 'pool' } },
      orderBy: { number: 'asc' },
    })
  })

  it.each([
    ['a code of the wrong length', 'S-K7M2', '1-1-1'],
    ['a code with an out-of-alphabet symbol', 'S-K7M2X!', '1-1-1'],
    ['an address with too few parts', 'S-K7M2X9', '1-1'],
    ['a non-numeric address', 'S-K7M2X9', '1-a-1'],
    ['an address past int4', 'S-K7M2X9', '1-1-2147483648'],
    ['an empty code', '', '1-1-1'],
    ['an empty address', 'S-K7M2X9', ''],
  ])('declines %s without touching the database', async (_label, code, address) => {
    // Scanners and crawlers are the common source of malformed input here. It
    // should cost a regex, not a query.
    await expect(resolveQrTarget(code, address)).resolves.toBeNull()

    expect(findSite).not.toHaveBeenCalled()
    expect(findUnit).not.toHaveBeenCalled()
  })

  it('declines an unknown site code, and never looks for the unit', async () => {
    findSite.mockResolvedValue(null as never)

    await expect(resolveQrTarget('S-ZZZZZZ', '1-1-1')).resolves.toBeNull()
    expect(findUnit).not.toHaveBeenCalled()
  })

  it('declines when no unit stands at the address', async () => {
    // The trade the address key makes (track 022 D1): a parcel rebuilt in place
    // keeps its cards, but a card for a spot nothing occupies must dead-end.
    findUnit.mockResolvedValue(null as never)

    await expect(resolveQrTarget('S-K7M2X9', '1-1-1')).resolves.toBeNull()
  })

  it('declines a unit whose only members are pool spares', async () => {
    // The filter leaves nothing, so the unit stands nowhere. Returning it would
    // render a page offering zero beds — resolve toward declining, never toward
    // a page that looks bookable and is not.
    findUnit.mockResolvedValue({ id: 'unit-1', items: [] } as never)

    await expect(resolveQrTarget('S-K7M2X9', '1-1-1')).resolves.toBeNull()
  })
})
