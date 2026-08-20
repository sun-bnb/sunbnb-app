/**
 * Printed QR card URLs (track 022).
 *
 * The cost of getting this wrong is physical: a wrong URL is discovered after a
 * stack of cards is printed, cut and glued to loungers. Two rules carry that
 * weight — the short form must be keyed by the UNIT (not the bed, not the seat
 * cuid), and a missing site code must degrade to the long URL rather than
 * blocking the print.
 */

import { describe, it, expect } from 'vitest'

import { qrCardUrl } from './qr-url'

const APP = 'https://sunbnb.app'
const SITE = 'cmbhmy2uu000012zrrzih3zzu'

describe('qrCardUrl', () => {
  it('prints the short address-keyed URL when the site has a code', () => {
    const url = qrCardUrl({
      appUrl: APP,
      siteId: SITE,
      siteCode: 'S-K7M2X9',
      item: { id: 'item-1', seatLabel: '1-101-2' },
    })

    expect(url).toBe('https://sunbnb.app/q/S-K7M2X9/1-1-1')
  })

  it('names the UNIT, so both beds under one parasol carry the same target', () => {
    // The page renders the whole unit whichever bed was scanned, so a member
    // segment would be printed data nothing reads. The card's visible label
    // still distinguishes the beds.
    const bedOne = qrCardUrl({
      appUrl: APP, siteId: SITE, siteCode: 'S-K7M2X9',
      item: { id: 'item-1', seatLabel: '1-101-1' },
    })
    const bedTwo = qrCardUrl({
      appUrl: APP, siteId: SITE, siteCode: 'S-K7M2X9',
      item: { id: 'item-2', seatLabel: '1-101-2' },
    })

    expect(bedOne).toBe(bedTwo)
  })

  it('unpacks the stored label into the address the route resolves by', () => {
    // `seatLabel` packs row and unit ordinal into one segment (`2-302-1`), which
    // is NOT what the URL carries. Getting this backwards prints `2-302` and
    // every card at the venue 404s.
    const url = qrCardUrl({
      appUrl: APP, siteId: SITE, siteCode: 'S-K7M2X9',
      item: { id: 'item-1', seatLabel: '2-302-1' },
    })

    expect(url).toBe('https://sunbnb.app/q/S-K7M2X9/2-3-2')
  })

  it('stays inside the QR version-3 budget at the worst address seen in real data', () => {
    // 42 characters is byte-mode ECC-M v3. Past it the symbol grows to 33×33 and
    // quietly costs scan distance on every card printed.
    const url = qrCardUrl({
      appUrl: APP, siteId: SITE, siteCode: 'S-K7M2X9',
      item: { id: 'item-1', seatLabel: '13-1525-2' },
    })

    expect(url).toBe('https://sunbnb.app/q/S-K7M2X9/13-15-25')
    expect(url.length).toBeLessThanOrEqual(42)
  })

  it('FALLS BACK to the legacy URL when the site has no code yet', () => {
    // The window before backfill:site-codes runs on an environment. Refusing to
    // print would block an operator on a platform migration they cannot see,
    // and the legacy URL still resolves — it redirects once the code exists.
    const url = qrCardUrl({
      appUrl: APP, siteId: SITE, siteCode: null,
      item: { id: 'item-1', seatLabel: '1-101-2' },
    })

    expect(url).toBe(`https://sunbnb.app/sites/${SITE}/pos/item-1`)
  })

  it('falls back for a seat with no label, or an unparseable one', () => {
    for (const seatLabel of [null, '', '101-1', '1-11-1', '1-abc-1']) {
      expect(
        qrCardUrl({ appUrl: APP, siteId: SITE, siteCode: 'S-K7M2X9', item: { id: 'item-1', seatLabel } }),
      ).toBe(`https://sunbnb.app/sites/${SITE}/pos/item-1`)
    }
  })
})
