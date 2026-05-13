import { describe, it, expect } from 'vitest'
import {
  generateChairGrid,
  generateTableGrid,
  SUNBED_WIDTH,
  SUNBED_HEIGHT,
  TABLE_SHAPE_DEFAULTS,
} from './grid'

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

const tableBaseConfig = {
  rows: 2,
  tablesPerRow: 3,
  horizontalGap: 0.8,
  verticalGap: 0.8,
  tableWidth: 1.2,
  tableHeight: 1.2,
  capacity: 4,
  shape: 'square' as const,
  rotation: 0,
}

describe('generateTableGrid', () => {
  it('produces rows × tablesPerRow cells numbered row-major', () => {
    const cells = generateTableGrid(tableBaseConfig)
    expect(cells).toHaveLength(6)
    expect(cells.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('places the first table at origin', () => {
    const [first] = generateTableGrid(tableBaseConfig)
    expect(first?.dx).toBe(0)
    expect(first?.dy).toBe(0)
  })

  it('spaces adjacent tables in a row by horizontalGap + tableWidth', () => {
    const cells = generateTableGrid(tableBaseConfig)
    const step = tableBaseConfig.horizontalGap + tableBaseConfig.tableWidth
    expect(cells[1]!.dx).toBeCloseTo(step, 6)
    expect(cells[2]!.dx).toBeCloseTo(2 * step, 6)
  })

  it('spaces rows by verticalGap + tableHeight', () => {
    const cells = generateTableGrid(tableBaseConfig)
    const rowStep = tableBaseConfig.verticalGap + tableBaseConfig.tableHeight
    const firstOfRow2 = cells[3]! // row 2, column 1
    expect(firstOfRow2.dy).toBeCloseTo(rowStep, 6)
    expect(firstOfRow2.dx).toBeCloseTo(0, 6)
  })

  it('propagates capacity and shape onto every cell', () => {
    const cells = generateTableGrid({ ...tableBaseConfig, capacity: 6, shape: 'round' })
    expect(cells.every((c) => c.capacity === 6)).toBe(true)
    expect(cells.every((c) => c.shape === 'round')).toBe(true)
  })

  it('rotates the grid 90°', () => {
    const cells = generateTableGrid({
      ...tableBaseConfig,
      rotation: 90,
      rows: 1,
      tablesPerRow: 2,
    })
    const step = tableBaseConfig.horizontalGap + tableBaseConfig.tableWidth
    expect(cells[1]!.dx).toBeCloseTo(0, 6)
    expect(cells[1]!.dy).toBeCloseTo(-step, 6)
  })

  it('returns no cells for zero rows or zero columns', () => {
    expect(generateTableGrid({ ...tableBaseConfig, rows: 0 })).toHaveLength(0)
    expect(generateTableGrid({ ...tableBaseConfig, tablesPerRow: 0 })).toHaveLength(0)
  })

  it('exposes sensible defaults via TABLE_SHAPE_DEFAULTS', () => {
    expect(TABLE_SHAPE_DEFAULTS.square.capacity).toBe(4)
    expect(TABLE_SHAPE_DEFAULTS.round.capacity).toBe(4)
    expect(TABLE_SHAPE_DEFAULTS.rect.capacity).toBe(2)
  })
})
