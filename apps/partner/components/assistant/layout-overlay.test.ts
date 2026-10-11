import { describe, it, expect } from 'vitest'
import { elementGhostLayer } from './layout-overlay'
import { parseGeometry, buildGhostModel, GEOMETRY_KINDS, LAYOUT_ELEMENTS_KIND } from './geometry-preview'
import { selectActivePreview, INITIAL_PREVIEW_UI } from './preview-store'

const wire = {
  geometry: {
    mode: 'schematic', moved: [], added: [], removed: [],
    elements: {
      added: [{ tempId: 'e0', type: 'pool', shape: 'ellipse', label: 'Pool', x: 10, y: 4, w: 12, h: 6, rotation: 90 }],
      moved: [{ id: 'el1', label: 'Bar', before: { x: 0, y: 0, w: 4, h: 2, rotation: 0 }, after: { x: 10, y: 6, w: 4, h: 2, rotation: 0 } }],
      removed: [{ id: 'el2', label: 'Old deck' }, { id: 'gone', label: 'Not loaded' }],
    },
  },
}
const lookup = (id: string) =>
  ({ el1: { shape: 'rect', rect: { x: 0, y: 0, w: 4, h: 2, rotation: 0 } }, el2: { shape: 'rect', rect: { x: 30, y: 2, w: 10, h: 6, rotation: 0 } } } as const)[id as 'el1']

describe('layout element overlay model', () => {
  it('parses the elements wire shape and counts it (a preview with ONLY elements is not empty)', () => {
    const geo = parseGeometry(wire)!
    expect(geo.elements.added).toHaveLength(1)
    expect(buildGhostModel(geo).counts).toEqual({ added: 1, moved: 1, removed: 2 })
    expect(parseGeometry({ geometry: { mode: 'schematic', moved: [], added: [], removed: [], elements: { added: [], moved: [], removed: [] } } })).toBeNull()
  })

  it('draws added at its rectangle, rotated about its centre; moved at AFTER with a connector; removed where it is now', () => {
    const { shapes, links } = elementGhostLayer(parseGeometry(wire)!.elements, lookup)
    const byKey = Object.fromEntries(shapes.map((s) => [s.key, s]))
    expect(byKey['a:e0']).toMatchObject({ kind: 'added', shape: 'ellipse', cx: 16, cy: 7, transform: 'rotate(90 16 7)' })
    expect(byKey['m:el1']).toMatchObject({ kind: 'moved', x: 10, y: 6, cx: 12, cy: 7 })
    expect(byKey['m:el1']!.transform).toBeUndefined()
    expect(byKey['r:el2']).toMatchObject({ kind: 'removed', x: 30, y: 2 })
    expect(links).toEqual([{ key: 'l:el1', from: { x: 2, y: 1 }, to: { x: 12, y: 7 } }])
  })

  it('skips a removed element the editor does not hold, and draws no connector for a pure resize', () => {
    const el = parseGeometry(wire)!.elements
    expect(elementGhostLayer(el, lookup).shapes.some((s) => s.key === 'r:gone')).toBe(false)
    const resize = { ...el, moved: [{ id: 'el1', label: 'Bar', before: { x: 0, y: 0, w: 4, h: 2, rotation: 0 }, after: { x: 0, y: 0, w: 8, h: 2, rotation: 0 } }] }
    // centre moves by 2 (width grows about the top-left), so a connector is expected; a rotation-only change has none
    const rot = { ...el, moved: [{ id: 'el1', label: 'Bar', before: { x: 0, y: 0, w: 4, h: 2, rotation: 0 }, after: { x: 0, y: 0, w: 4, h: 2, rotation: 45 } }] }
    expect(elementGhostLayer(resize, lookup).links).toHaveLength(1)
    expect(elementGhostLayer(rot, lookup).links).toHaveLength(0)
  })

  it('layout proposals are previewable: selected like inventory ones and only while proposed', () => {
    expect(GEOMETRY_KINDS).toContain(LAYOUT_ELEMENTS_KIND)
    const p = (status: string) => [{ actionId: 'a1', kind: LAYOUT_ELEMENTS_KIND, status, preview: wire }] as never
    expect(selectActivePreview(p('proposed'), INITIAL_PREVIEW_UI)?.actionId).toBe('a1')
    expect(selectActivePreview(p('applied'), INITIAL_PREVIEW_UI)).toBeNull()
  })
})
