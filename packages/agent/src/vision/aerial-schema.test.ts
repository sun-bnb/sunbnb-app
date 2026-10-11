import { describe, expect, it } from 'vitest'
import { AERIAL_DESCRIPTOR_SCHEMA, validateAerialDescriptor, type AerialDescriptorV1 } from './aerial-schema.ts'

const VALID: AerialDescriptorV1 = {
  image: { w: 2000, h: 1500 },
  view: 'nadir',
  usable: true,
  bed: { lengthPx: 42, widthPx: 17 },
  shoreline: { points: [{ x: 0, y: 1400 }, { x: 2000, y: 1380 }], seaSide: 'bottom' },
  parcels: [
    {
      id: 'A',
      rows: [
        { first: { x: 200, y: 1200 }, last: { x: 1800, y: 1190 }, units: 12, paired: true, occludedBeds: 2, confidence: 0.9 },
        { first: { x: 200, y: 1100 }, last: { x: 1800, y: 1090 }, units: 12, paired: true, occludedBeds: 0, confidence: 0.8 },
      ],
      facing: 'sea',
      confidence: 0.85,
    },
  ],
  ignored: ['stacked beds by the kiosk'],
}

const clone = (): AerialDescriptorV1 => structuredClone(VALID)

/** Walk the wire schema: every object closed and fully required; no keywords outside structured outputs. */
function checkWire(s: Record<string, unknown>, path = 'schema'): string[] {
  const out: string[] = []
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'])
    if (k in s) out.push(`${path} uses ${k}`)
  if (s.type === 'object') {
    const props = s.properties as Record<string, Record<string, unknown>>
    if (s.additionalProperties !== false) out.push(`${path} is open`)
    const req = new Set(s.required as string[])
    for (const [k, sub] of Object.entries(props)) {
      if (!req.has(k)) out.push(`${path}.${k} optional`)
      out.push(...checkWire(sub, `${path}.${k}`))
    }
  }
  if (s.type === 'array') out.push(...checkWire(s.items as Record<string, unknown>, `${path}[]`))
  return out
}

describe('AERIAL_DESCRIPTOR_SCHEMA', () => {
  it('stays inside the structured-output subset (closed, all-required, no range keywords)', () => {
    expect(checkWire(AERIAL_DESCRIPTOR_SCHEMA)).toEqual([])
  })
})

describe('validateAerialDescriptor', () => {
  it('accepts a valid descriptor (and the matching expected size)', () => {
    expect(validateAerialDescriptor(VALID, { w: 2000, h: 1500 })).toEqual({ ok: true, descriptor: VALID })
  })

  it('rejects shape errors via validateJsonSchema', () => {
    const d = clone() as unknown as Record<string, unknown>
    delete d.bed
    d.extra = 1
    const r = validateAerialDescriptor(d)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['descriptor.bed is required', 'unknown field: extra']))
  })

  it('range checks: coords in image, confidences 0..1, units >= 1, occlusion, unique ids, size match', () => {
    const d = clone()
    d.parcels[0]!.rows[0]!.first = { x: 2100, y: 10 }
    d.parcels[0]!.rows[0]!.units = 0
    d.parcels[0]!.rows[1]!.confidence = 1.2
    d.parcels[0]!.rows[1]!.occludedBeds = 25
    d.parcels[0]!.confidence = -0.1
    d.parcels.push({ ...d.parcels[0]!, rows: [d.parcels[0]!.rows[1]!] })
    d.shoreline.points.push({ x: 5, y: -10 })
    const r = validateAerialDescriptor(d, { w: 1000, h: 1500 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    const all = r.errors.join('\n')
    expect(all).toMatch(/descriptor.image is 2000x1500, expected 1000x1500/)
    expect(all).toMatch(/rows\[0\].first \(2100, 10\) is outside/)
    expect(all).toMatch(/rows\[0\].units must be >= 1/)
    expect(all).toMatch(/rows\[1\].confidence must be within 0..1/)
    expect(all).toMatch(/rows\[1\].occludedBeds exceeds/)
    expect(all).toMatch(/parcels\[0\].confidence must be within 0..1/)
    expect(all).toMatch(/parcels\[1\].id "A" is not unique/)
    expect(all).toMatch(/shoreline.points\[2\]/)
  })

  it('tolerates points on the edge (±2 px) and requires a bed size when beds are reported', () => {
    const d = clone()
    d.parcels[0]!.rows[0]!.first = { x: 2001.5, y: -1 }
    expect(validateAerialDescriptor(d).ok).toBe(true)
    d.bed = { lengthPx: 0, widthPx: 0 }
    expect(validateAerialDescriptor(d).ok).toBe(false)
  })

  it('rejects an empty row list but accepts an unusable photo with no parcels', () => {
    const d = clone()
    d.parcels[0]!.rows = []
    expect(validateAerialDescriptor(d).ok).toBe(false)
    expect(validateAerialDescriptor({ ...clone(), usable: false, view: 'oblique', parcels: [], bed: { lengthPx: 0, widthPx: 0 } }).ok).toBe(true)
  })
})
