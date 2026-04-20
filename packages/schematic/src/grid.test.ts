import { describe, it, expect } from 'vitest'
import { generateChairGrid, SUNBED_WIDTH, SUNBED_HEIGHT } from './grid'

const baseConfig = {
  group: 1,
  rotation: 0,
  rows: 2,
  seatsPerRow: 3,
  horizontalGap: 1,
  verticalGap: 1,
  intraPairGap: 0.2,
  pairSeats: false,
}

describe('generateChairGrid', () => {
  it('produces rows × seatsPerRow cells', () => {
    const cells = generateChairGrid(baseConfig)
    expect(cells).toHaveLength(6)
  })

  it('places the first cell at origin', () => {
    const [first] = generateChairGrid(baseConfig)
    expect(first?.dx).toBe(0)
    expect(first?.dy).toBe(0)
  })

  it('spaces seats by horizontalGap + sunbed width along a row', () => {
    const cells = generateChairGrid(baseConfig)
    const expectedStep = baseConfig.horizontalGap + SUNBED_WIDTH
    expect(cells[1]!.dx).toBeCloseTo(expectedStep, 6)
    expect(cells[2]!.dx).toBeCloseTo(2 * expectedStep, 6)
  })

  it('spaces rows by verticalGap + sunbed height', () => {
    const cells = generateChairGrid(baseConfig)
    const expectedRowStep = baseConfig.verticalGap + SUNBED_HEIGHT
    const firstOfRow2 = cells.find((c) => c.tempId === '1-R02C01')
    expect(firstOfRow2?.dy).toBeCloseTo(expectedRowStep, 6)
    expect(firstOfRow2?.dx).toBeCloseTo(0, 6)
  })

  it('encodes seat number as group + row + seat (zero-padded)', () => {
    const cells = generateChairGrid({ ...baseConfig, group: 3, rows: 1, seatsPerRow: 2 })
    expect(cells[0]!.number).toBe(30101)
    expect(cells[1]!.number).toBe(30102)
  })

  it('rotates the grid 90° (along-row axis maps to north)', () => {
    const cells = generateChairGrid({ ...baseConfig, rotation: 90, rows: 1, seatsPerRow: 2 })
    const step = baseConfig.horizontalGap + SUNBED_WIDTH
    // At rotation 90°, increasing localX should produce -dy (north shrinks) and ~0 dx.
    expect(cells[1]!.dx).toBeCloseTo(0, 6)
    expect(cells[1]!.dy).toBeCloseTo(-step, 6)
  })

  it('pairs seats when pairSeats=true with intra-pair gap', () => {
    const cells = generateChairGrid({ ...baseConfig, rows: 1, seatsPerRow: 4, pairSeats: true })
    expect(cells).toHaveLength(4)

    const a = cells[0]!
    const b = cells[1]!
    expect(a.pairTempId).toBe(b.tempId)
    expect(b.pairTempId).toBe(a.tempId)
    expect(a.isPrimary).toBe(true)
    expect(b.isPrimary).toBe(false)

    const pairStep = baseConfig.intraPairGap + SUNBED_WIDTH
    expect(b.dx - a.dx).toBeCloseTo(pairStep, 6)

    // Gap between pairs uses horizontalGap (not intra-pair gap)
    const c = cells[2]!
    const interPairStep = baseConfig.horizontalGap + SUNBED_WIDTH
    expect(c.dx - b.dx).toBeCloseTo(interPairStep, 6)
  })

  it('leaves trailing odd seat unpaired when pairSeats=true', () => {
    const cells = generateChairGrid({ ...baseConfig, rows: 1, seatsPerRow: 3, pairSeats: true })
    expect(cells).toHaveLength(3)
    expect(cells[0]!.pairTempId).toBe(cells[1]!.tempId)
    expect(cells[2]!.pairTempId).toBeUndefined()
  })

  it('returns no cells for zero rows', () => {
    expect(generateChairGrid({ ...baseConfig, rows: 0 })).toHaveLength(0)
  })
})
