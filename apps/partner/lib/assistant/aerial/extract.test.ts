/**
 * runAerialExtraction (track 030 S7). Requirements: at most ONE billable model call per upload; a
 * cached (done) or in-flight (running) extraction touches no counter and calls no model; only the
 * CAS winner spends limits; a refused limit marks the attempt failed (re-claimable) without a model
 * call; a model failure records its usage; success stores descriptor + usage for that attempt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@repo/data/assistant', () => ({ claimAerialExtraction: vi.fn(), saveAerialDescriptor: vi.fn(), failAerialExtraction: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }))

import { runAerialExtraction, type AerialExtractDeps } from './extract'

const DESC = { image: { w: 100, h: 80 }, view: 'nadir', usable: true, bed: { lengthPx: 10, widthPx: 4 }, shoreline: { points: [], seaSide: 'none' }, parcels: [{ id: 'A' }, { id: 'B' }], ignored: [] }

function deps(over: Partial<AerialExtractDeps> = {}): AerialExtractDeps {
  return {
    claim: vi.fn().mockResolvedValue({ claimed: true, startedAt: 'T1' }),
    save: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
    allowTurn: vi.fn().mockResolvedValue('ok'),
    allowAerial: vi.fn().mockResolvedValue(true),
    allowJob: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue(Buffer.from('orig')),
    prepare: vi.fn().mockResolvedValue({ data: Buffer.from('jpg'), width: 100, height: 80, mediaType: 'image/jpeg' }),
    extract: vi.fn().mockResolvedValue({ ok: true, descriptor: DESC, usage: { inputTokens: 1500, outputTokens: 900 }, model: 'claude-opus-5-5' }),
    ...over,
  }
}
const input = { uploadId: 'up1', accountId: 'owner', userId: 'owner', url: 'https://blob/x' }

const noSpend = (d: AerialExtractDeps) => {
  expect(d.allowTurn).not.toHaveBeenCalled()
  expect(d.allowAerial).not.toHaveBeenCalled()
  expect(d.allowJob).not.toHaveBeenCalled()
  expect(d.extract).not.toHaveBeenCalled()
}

beforeEach(() => vi.clearAllMocks())

describe('runAerialExtraction', () => {
  it('cache hit: a done descriptor is answered from the row, no counter, no model call', async () => {
    const d = deps({ claim: vi.fn().mockResolvedValue({ claimed: false, reason: 'done', state: { status: 'done', startedAt: 'T0', descriptor: DESC } }) })
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'done', usable: true, view: 'nadir', parcels: 2 })
    noSpend(d)
  })

  it('a concurrent caller (attempt already running) gets running, no counter, no model call', async () => {
    const d = deps({ claim: vi.fn().mockResolvedValue({ claimed: false, reason: 'busy', state: { status: 'running', startedAt: 'T0' } }) })
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'running' })
    noSpend(d)
  })

  it('a missing / foreign upload is not_found and spends nothing', async () => {
    const d = deps({ claim: vi.fn().mockResolvedValue({ claimed: false, reason: 'not_found', state: null }) })
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'failed', error: 'not_found' })
    noSpend(d)
  })

  it('the claim winner spends each limit once, calls the model once and stores descriptor + usage for its attempt', async () => {
    const d = deps()
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'done', usable: true, view: 'nadir', parcels: 2 })
    expect(d.claim).toHaveBeenCalledWith('up1', 'owner')
    expect(d.allowTurn).toHaveBeenCalledTimes(1)
    expect(d.allowAerial).toHaveBeenCalledTimes(1)
    expect(d.allowJob).toHaveBeenCalledTimes(1)
    expect(d.extract).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.extract).mock.calls[0]![0]).toMatchObject({ image: { width: 100, height: 80, mediaType: 'image/jpeg' }, effort: 'high' })
    expect(d.save).toHaveBeenCalledWith('up1', 'owner', 'T1', { descriptor: DESC, usage: { inputTokens: 1500, outputTokens: 900 }, model: 'claude-opus-5-5' })
  })

  it.each([
    ['aerial sub-cap', { allowAerial: vi.fn().mockResolvedValue(false) }, 'aerial_limit'],
    ['extraction-job cap', { allowJob: vi.fn().mockResolvedValue(false) }, 'extraction_limit'],
    ['global budget', { allowTurn: vi.fn().mockResolvedValue('budget') }, 'budget'],
  ] as const)('%s refused: attempt marked failed (re-claimable), no model call', async (_n, over, code) => {
    const d = deps(over as Partial<AerialExtractDeps>)
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'failed', error: code })
    expect(d.extract).not.toHaveBeenCalled()
    expect(d.fail).toHaveBeenCalledWith('up1', 'owner', 'T1', code)
  })

  it('a model failure is recorded with the tokens it spent', async () => {
    const d = deps({ extract: vi.fn().mockResolvedValue({ ok: false, error: { kind: 'schema_invalid', message: 'x', errors: [] }, usage: { inputTokens: 10, outputTokens: 5 } }) })
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'failed', error: 'unreadable' })
    expect(d.fail).toHaveBeenCalledWith('up1', 'owner', 'T1', 'unreadable', { inputTokens: 10, outputTokens: 5 })
    expect(d.save).not.toHaveBeenCalled()
  })

  it('an unreadable image fails the attempt before any model call', async () => {
    const d = deps({ prepare: vi.fn().mockRejectedValue(new Error('bad')) })
    expect(await runAerialExtraction(input, d)).toEqual({ status: 'failed', error: 'unreadable' })
    expect(d.extract).not.toHaveBeenCalled()
  })
})
