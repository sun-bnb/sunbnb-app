import { describe, expect, it } from 'vitest'
import { COAST_REGIONS, INLAND_EXTRACTS, regionBoxes } from './coast-regions.ts'

describe('coast regions', () => {
  it('every inland extract belongs to a defined region (the import runs both layers per region)', () => {
    for (const r of Object.keys(INLAND_EXTRACTS)) expect(COAST_REGIONS[r], r).toBeDefined()
  })
  it('every box is a real box', () => {
    for (const [, b] of regionBoxes(Object.keys(COAST_REGIONS))) {
      expect(b.south).toBeLessThan(b.north)
      expect(b.west).toBeLessThan(b.east)
    }
  })
  it('Austria covers its lakes and the Danube (Wörthersee, Neusiedler See, Vienna)', () => {
    const [box] = COAST_REGIONS.austria!
    for (const [lat, lng] of [[46.62, 14.15], [47.83, 16.75], [48.22, 16.41]]) {
      expect(lat! > box!.south && lat! < box!.north && lng! > box!.west && lng! < box!.east).toBe(true)
    }
  })
})
