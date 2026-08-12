/**
 * Reservation state machine — pure model tests (track 018 P2).
 *
 * Requirements source: `.claude/tracks/018-state-machine-intended.md`.
 * Three layers:
 *   1. deriveState — the K1–K7 storage tuples from the de facto doc map to the
 *      intended compound states (including the overloaded paid-in-cash cases).
 *   2. Table semantics — allowed cells resolve; the D-list divergences are
 *      MUST-REJECT cells here at the model level (they go red at the action
 *      level in P3/P4 when actions are driven through the table).
 *   3. Table properties + partitionAmount — invariants I1/I4 checkable over the
 *      table itself, no interpreter needed.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveState,
  resolveTransition,
  partitionAmount,
  TRANSITIONS,
  EVENTS,
  type CompoundState,
} from './reservation-machine'

// ─── 1. deriveState: storage tuples → compound state ─────────────────────────

describe('deriveState', () => {
  it('K1 online paid booking, before arrival', () => {
    expect(deriveState({ status: 'complete', operationalStatus: 'expected' }))
      .toEqual({ kind: 'online', pay: 'complete', occ: 'expected', released: false })
  })

  it('K1 online, checked in (today-row wins over stale parent)', () => {
    expect(deriveState({
      status: 'complete', operationalStatus: 'expected', todayOperationalStatus: 'checked-in',
    })).toEqual({ kind: 'online', pay: 'complete', occ: 'present', released: false })
  })

  it('K1 online mid-payment', () => {
    expect(deriveState({ status: 'processing', operationalStatus: 'expected' }).pay)
      .toBe('processing')
  })

  it('K2 cash walk-in, unsettled vs settled (TillEntry presence is the pay axis)', () => {
    const base = { status: 'paid-in-cash', operationalStatus: 'walked-in' }
    expect(deriveState({ ...base, settled: false }))
      .toEqual({ kind: 'walkin', pay: 'unsettled', occ: 'present', released: false })
    expect(deriveState({ ...base, settled: true }).pay).toBe('settled')
  })

  it('K2 multiday walk-in between days (paid-in-cash + expected) stays kind walkin', () => {
    expect(deriveState({ status: 'paid-in-cash', operationalStatus: 'expected', settled: true }))
      .toEqual({ kind: 'walkin', pay: 'settled', occ: 'expected', released: false })
  })

  it('K3 QR-collect phases: processing/complete + walked-in derive as walkin, not online', () => {
    expect(deriveState({ status: 'processing', operationalStatus: 'walked-in' }))
      .toEqual({ kind: 'walkin', pay: 'collecting', occ: 'present', released: false })
    expect(deriveState({ status: 'complete', operationalStatus: 'walked-in' }).pay)
      .toBe('collected')
  })

  it('collected multiday walk-in cycled to expected converges to online·complete (documented)', () => {
    expect(deriveState({ status: 'complete', operationalStatus: 'expected' }).kind).toBe('online')
  })

  it('K4 hold', () => {
    expect(deriveState({ status: 'held', operationalStatus: 'expected' }))
      .toEqual({ kind: 'hold', pay: 'none', occ: 'expected', released: false })
  })

  it('K5 comp: paid-in-cash overload disambiguated by isComp/op', () => {
    expect(deriveState({ status: 'paid-in-cash', operationalStatus: 'comp', isComp: true }))
      .toEqual({ kind: 'comp', pay: 'none', occ: 'present', released: false })
  })

  it('K6 block: parent op always authoritative, even with a stray today-row', () => {
    expect(deriveState({
      status: 'paid-in-cash', operationalStatus: 'blocked', todayOperationalStatus: 'expected',
    })).toEqual({ kind: 'block', pay: 'none', occ: 'none', released: false })
  })

  it('K7 failed, including the legacy error literal', () => {
    expect(deriveState({ status: 'payment_failed', operationalStatus: 'expected' }).pay)
      .toBe('payment_failed')
    expect(deriveState({ status: 'error', operationalStatus: 'expected' }).pay)
      .toBe('payment_failed')
  })

  it('release rule: departed/no-show release ONLY when the stay is over', () => {
    const departed = { status: 'paid-in-cash', operationalStatus: 'departed', settled: true }
    expect(deriveState({ ...departed, stayOver: true }).released).toBe(true)
    expect(deriveState({ ...departed, stayOver: false }).released).toBe(false)
    expect(deriveState({ status: 'complete', operationalStatus: 'no-show', stayOver: true }).released).toBe(true)
  })

  it('defensive: unknown statuses never derive as paid', () => {
    expect(deriveState({ status: 'garbage', operationalStatus: 'expected' }).pay).toBe('pending')
    expect(deriveState({ status: 'paid-in-cash', operationalStatus: 'walked-in' }).pay).toBe('unsettled')
  })
})

// ─── 2. Table semantics: allowed cells + D-list reject cells ─────────────────

const S = (kind: string, pay: string, occ: string): CompoundState =>
  ({ kind, pay, occ, released: false }) as CompoundState

describe('resolveTransition — allowed cells', () => {
  it('creates resolve only against no existing state', () => {
    expect(resolveTransition(null, 'staff.walkIn.cash')?.post)
      .toEqual({ kind: 'walkin', pay: 'settled', occ: 'present' })
    expect(resolveTransition(S('walkin', 'settled', 'present'), 'staff.walkIn.cash')).toBeNull()
  })

  it('collect rail: start → confirm / fail / abandon', () => {
    expect(resolveTransition(S('walkin', 'unsettled', 'present'), 'collect.start')?.post.pay)
      .toBe('collecting')
    expect(resolveTransition(S('walkin', 'collecting', 'present'), 'pay.confirm')?.post.pay)
      .toBe('collected')
    expect(resolveTransition(S('walkin', 'collecting', 'present'), 'pay.fail')?.post.pay)
      .toBe('unsettled')
  })

  it('depart branches on hasFutureDays vs lastDay', () => {
    const s = S('walkin', 'settled', 'present')
    expect(resolveTransition(s, 'staff.depart', ['hasFutureDays'])?.post.occ).toBe('expected')
    expect(resolveTransition(s, 'staff.depart', ['lastDay'])?.post.occ).toBe('departed')
    // No condition supplied → no row matches (callers must state the fact)
    expect(resolveTransition(s, 'staff.depart')).toBeNull()
  })

  it('undo-depart re-seats a same-day departed cash walk-in, with conflict recheck (P1 decision)', () => {
    const t = resolveTransition(S('walkin', 'settled', 'departed'), 'staff.resume.undoDepart', ['sameCivilDay'])
    expect(t?.post.occ).toBe('present')
    expect(t?.effects).toContain('conflictRecheck')
    // Next day: not undoable
    expect(resolveTransition(S('walkin', 'settled', 'departed'), 'staff.resume.undoDepart')).toBeNull()
  })

  it('settled split carries the till; unsettled split does not touch it (B1 fix)', () => {
    const settled = resolveTransition(S('walkin', 'settled', 'present'), 'split.subset', ['subset'])
    expect(settled?.effects).toEqual(expect.arrayContaining(['seatPartition', 'tillPartition', 'lineageLink']))
    const unsettled = resolveTransition(S('walkin', 'unsettled', 'present'), 'split.subset', ['subset'])
    expect(unsettled?.effects).not.toContain('tillPartition')
  })

  it('seat-unreserve works on non-present cash parties (between-days / mid-stay-departed) — bulk refund cells', () => {
    // Widened 2026-08-12: the disconnect/partition never touches occupancy.
    const expectedLeg = resolveTransition(S('walkin', 'settled', 'expected'), 'staff.unreserve.seat', ['subset'])
    expect(expectedLeg?.effects).toEqual(expect.arrayContaining(['tillPartition', 'creditNoteIssue']))
    const departedLeg = resolveTransition(S('walkin', 'unsettled', 'departed'), 'staff.unreserve.seat', ['subset'])
    expect(departedLeg?.effects).toContain('seatDisconnect')
    // Still subset-gated, still walkin-only
    expect(resolveTransition(S('walkin', 'settled', 'expected'), 'staff.unreserve.seat')).toBeNull()
    expect(resolveTransition(S('online', 'complete', 'expected'), 'staff.unreserve.seat', ['subset'])).toBeNull()
  })

  it('refund-unreserve keeps the row, voids the till, and issues a credit note (I2/I4)', () => {
    const t = resolveTransition(S('walkin', 'settled', 'present'), 'staff.unreserve.whole')
    expect(t?.post).toMatchObject({ pay: 'refunded', kept: true })
    expect(t?.post.deleted).toBeUndefined()
    expect(t?.effects).toEqual(expect.arrayContaining(['tillVoid', 'creditNoteIssue']))
  })

  it('unsettled unreserve is a plain delete (zero-money row)', () => {
    expect(resolveTransition(S('walkin', 'unsettled', 'present'), 'staff.unreserve.whole')?.post.deleted)
      .toBe(true)
  })

  it('hold converts in place with the day-row written atomically (D9)', () => {
    const cash = resolveTransition(S('hold', 'none', 'expected'), 'convert.holdToWalkIn.whole', ['cash'])
    expect(cash?.post).toEqual({ kind: 'walkin', pay: 'settled', occ: 'present' })
    expect(cash?.effects).toEqual(expect.arrayContaining(['tillRecord', 'receiptIssue', 'dayRow']))
    const card = resolveTransition(S('hold', 'none', 'expected'), 'convert.holdToWalkIn.whole')
    expect(card?.post.pay).toBe('unsettled')
  })
})

describe('resolveTransition — MUST-REJECT cells (the D-list, model level)', () => {
  it('D6: collect.start on an already-settled walk-in is rejected', () => {
    expect(resolveTransition(S('walkin', 'settled', 'present'), 'collect.start')).toBeNull()
  })

  it('D5: collect.abandon never deletes — its only row reverts to unsettled', () => {
    const rows = TRANSITIONS.filter((t) => t.event === 'collect.abandon')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.post).toEqual({ pay: 'unsettled' })
  })

  it('D10: check-in requires online·complete — holds and mid-payment rows rejected', () => {
    expect(resolveTransition(S('hold', 'none', 'expected'), 'staff.checkIn')).toBeNull()
    expect(resolveTransition(S('online', 'pending', 'expected'), 'staff.checkIn')).toBeNull()
    expect(resolveTransition(S('online', 'processing', 'expected'), 'staff.checkIn')).toBeNull()
    expect(resolveTransition(S('online', 'complete', 'expected'), 'staff.checkIn')).not.toBeNull()
  })

  it('double-settle rejected: staff.settle has no row for pay=settled', () => {
    expect(resolveTransition(S('walkin', 'settled', 'present'), 'staff.settle')).toBeNull()
  })

  it('splits rejected for in-flight and online-paid reservations', () => {
    expect(resolveTransition(S('walkin', 'collecting', 'present'), 'split.subset', ['subset'])).toBeNull()
    expect(resolveTransition(S('walkin', 'collected', 'present'), 'split.subset', ['subset'])).toBeNull()
    expect(resolveTransition(S('online', 'complete', 'present'), 'split.subset', ['subset'])).toBeNull()
  })

  it('I4/D12: cron.gc has no cell for settled walk-ins — money history survives the sweep', () => {
    expect(resolveTransition(S('walkin', 'settled', 'departed'), 'cron.gc', ['expired'])).toBeNull()
    expect(resolveTransition(S('walkin', 'unsettled', 'departed'), 'cron.gc', ['expired'])?.post.deleted).toBe(true)
  })

  it('cron.gc never sweeps a present (seated) mid-payment reservation', () => {
    expect(resolveTransition(S('online', 'processing', 'present'), 'cron.gc', ['stale15m'])).toBeNull()
  })

  it('move rejected once departed/no-show', () => {
    expect(resolveTransition(S('online', 'complete', 'departed'), 'staff.move')).toBeNull()
    expect(resolveTransition(S('walkin', 'settled', 'no-show'), 'staff.move')).toBeNull()
  })
})

// ─── 3. Table properties + money partition ───────────────────────────────────

describe('table properties', () => {
  it('every declared event has at least one row, and every row uses a declared event', () => {
    const rowEvents = new Set(TRANSITIONS.map((t) => t.event))
    for (const e of EVENTS) expect(rowEvents.has(e), `event ${e} has no rows`).toBe(true)
    for (const t of TRANSITIONS) expect(EVENTS).toContain(t.event)
  })

  it('I4: no row deletes a money state (settled/collecting/collected/complete/refunded)', () => {
    const moneyPays = new Set(['settled', 'collecting', 'collected', 'complete', 'refunded'])
    for (const t of TRANSITIONS) {
      if (!t.post.deleted || t.pre === 'create') continue
      for (const pay of t.pre.pay ?? []) {
        expect(moneyPays.has(pay), `${t.event} deletes money state ${pay}`).toBe(false)
      }
      // A delete row with an unconstrained pay axis would silently cover money
      // states — every delete row must constrain pay, except zero-money kinds.
      const zeroMoneyKinds = ['hold', 'comp', 'block']
      if (!t.pre.pay) {
        expect(t.pre.kind.every((k) => zeroMoneyKinds.includes(k)),
          `${t.event} deletes without a pay constraint on kinds ${t.pre.kind}`).toBe(true)
      }
    }
  })

  it('deleteRow effect appears iff the row deletes', () => {
    for (const t of TRANSITIONS) {
      expect(t.effects.includes('deleteRow'), `${t.event}: deleteRow/effect mismatch`)
        .toBe(t.post.deleted === true)
    }
  })

  it('every kind-changing or occupancy-changing row writes the day-row atomically (D7/D9)', () => {
    for (const t of TRANSITIONS) {
      if (t.pre === 'create' || t.post.deleted) continue
      const changesOcc = t.post.occ !== undefined
      const changesKind = t.post.kind !== undefined
      if (changesOcc || changesKind) {
        expect(t.effects.includes('dayRow'), `${t.event} changes occ/kind without dayRow`).toBe(true)
      }
    }
  })
})

describe('partitionAmount (I1)', () => {
  it('preserves the sum exactly, including awkward cents', () => {
    for (const [total, weights] of [
      [10, [1, 1, 1]], [45.5, [12.5, 12.5, 20.5]], [0.01, [1, 1]], [99.99, [3, 7]],
    ] as [number, number[]][]) {
      const parts = partitionAmount(total, weights)
      expect(Math.round(parts.reduce((s, p) => s + p, 0) * 100)).toBe(Math.round(total * 100))
      expect(parts).toHaveLength(weights.length)
    }
  })

  it('is proportional for clean divisions', () => {
    expect(partitionAmount(40, [10, 10, 20])).toEqual([10, 10, 20])
  })

  it('falls back to equal split on zero/negative weights', () => {
    expect(partitionAmount(9, [0, 0, 0])).toEqual([3, 3, 3])
  })

  it('handles empty input', () => {
    expect(partitionAmount(10, [])).toEqual([])
  })
})
