import { describe, it, expect, beforeEach } from 'vitest'
import {
  INITIAL_PREVIEW_UI, reducePreviewUi, selectActivePreview, dispatchPreview, getPreviewUi,
} from './preview-store'

// Act-immediately: the only proposal still pending (and ghosted) is a DELETE, so the fixture removes a seat.
const geo = { geometry: { mode: 'geo', removed: [{ id: 's1', label: '1-1-1-1' }] } }
const prop = (actionId: string, over: Record<string, unknown> = {}) => ({
  actionId, kind: 'inventory_batch', status: 'proposed' as const, preview: geo, ...over,
})

describe('selectActivePreview', () => {
  it('picks the most recent proposed inventory_batch with geometry', () => {
    expect(selectActivePreview([prop('a'), prop('b')], INITIAL_PREVIEW_UI)?.actionId).toBe('b')
  })
  it('ignores other kinds, resolved statuses and previews without geometry', () => {
    const list = [prop('a'), prop('b', { kind: 'site_fields' }), prop('c', { status: 'applied' }), prop('d', { preview: { changes: [] } })]
    expect(selectActivePreview(list, INITIAL_PREVIEW_UI)?.actionId).toBe('a')
  })
  it('ghosts ONLY pending deletes: a moved / added geometry is never drawn, applied or not', () => {
    const move = { geometry: { mode: 'geo', moved: [{ id: 's1', label: 'x', before: { lat: 1, lng: 1 }, after: { lat: 1, lng: 2 } }], added: [{ tempId: 't', at: { lat: 1, lng: 1 } }] } }
    expect(selectActivePreview([prop('m', { preview: move })], INITIAL_PREVIEW_UI)).toBeNull()
    expect(selectActivePreview([prop('m', { preview: move, status: 'applied' })], INITIAL_PREVIEW_UI)).toBeNull()
    const elementDelete = { geometry: { mode: 'schematic', elements: { removed: [{ id: 'e1', label: 'Bar' }] } } }
    expect(selectActivePreview([prop('e', { kind: 'layout_elements', preview: elementDelete })], INITIAL_PREVIEW_UI)?.actionId).toBe('e')
  })
  it('clears once the proposal is applied/undone/rejected', () => {
    for (const status of ['applied', 'undone', 'rejected', 'expired', 'failed'] as const) {
      expect(selectActivePreview([prop('a', { status })], INITIAL_PREVIEW_UI)).toBeNull()
    }
  })
  it('a hidden card is not auto-shown; falls back to an earlier visible one', () => {
    const ui = reducePreviewUi(INITIAL_PREVIEW_UI, { type: 'hide', actionId: 'b' })
    expect(selectActivePreview([prop('a'), prop('b')], ui)?.actionId).toBe('a')
    expect(selectActivePreview([prop('b')], ui)).toBeNull()
  })
  it('an explicit show overrides "latest" and un-hides', () => {
    let ui = reducePreviewUi(INITIAL_PREVIEW_UI, { type: 'hide', actionId: 'a' })
    ui = reducePreviewUi(ui, { type: 'show', actionId: 'a' })
    expect(ui.hidden).toEqual([])
    expect(selectActivePreview([prop('a'), prop('b')], ui)?.actionId).toBe('a')
  })
  it('a forced card that is no longer proposed falls back to latest', () => {
    const ui = reducePreviewUi(INITIAL_PREVIEW_UI, { type: 'show', actionId: 'a' })
    expect(selectActivePreview([prop('a', { status: 'applied' }), prop('b')], ui)?.actionId).toBe('b')
  })
})

describe('reducePreviewUi', () => {
  it('show bumps focusNonce each time (re-fit) and records peek', () => {
    const a = reducePreviewUi(INITIAL_PREVIEW_UI, { type: 'show', actionId: 'x', peek: true })
    const b = reducePreviewUi(a, { type: 'show', actionId: 'x' })
    expect([a.focusNonce, b.focusNonce]).toEqual([1, 2])
    expect([a.peek, b.peek]).toEqual([true, false])
  })
  it('hide clears forced + peek and is idempotent', () => {
    const shown = reducePreviewUi(INITIAL_PREVIEW_UI, { type: 'show', actionId: 'x', peek: true })
    const hidden = reducePreviewUi(shown, { type: 'hide', actionId: 'x' })
    expect(hidden).toMatchObject({ forcedId: null, peek: false, hidden: ['x'] })
    expect(reducePreviewUi(hidden, { type: 'hide', actionId: 'x' }).hidden).toEqual(['x'])
  })
  it('peek no-op returns the same object', () => {
    expect(reducePreviewUi(INITIAL_PREVIEW_UI, { type: 'peek', value: false })).toBe(INITIAL_PREVIEW_UI)
  })
})

describe('module store', () => {
  beforeEach(() => dispatchPreview('s1', { type: 'reset' }))
  it('keeps state per site', () => {
    dispatchPreview('s1', { type: 'show', actionId: 'x' })
    expect(getPreviewUi('s1').forcedId).toBe('x')
    expect(getPreviewUi('s2')).toBe(INITIAL_PREVIEW_UI)
  })
})
