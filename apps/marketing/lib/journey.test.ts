import { describe, expect, it } from 'vitest'
import { initialJourney, journeyReducer, liveAttach, resumedJourney, type JourneyEvent, type JourneyState } from './journey.ts'

const beach = { placeId: 'p1', name: 'Platja de Muro', address: 'Mallorca', lat: 39.8, lng: 3.1 }
const run = (events: JourneyEvent[], from: JourneyState = initialJourney()) => events.reduce(journeyReducer, from)
const keys = (s: JourneyState) => s.msgs.map((m) => `${m.from}:${m.key ?? m.text}`)

describe('journey — one conversation from beach to go-live', () => {
  it('opens with the agent asking for the beach, with the start chips live', () => {
    const s = initialJourney()
    expect(s.step).toBe('beach')
    expect(liveAttach(s)?.attach).toBe('start')
  })

  it('a picked beach is echoed as the visitor’s own message and asks the qualifier during the fly-in', () => {
    const s = run([{ type: 'beachPicked', beach, count: null, runs: [] }])
    expect(s.step).toBe('flying')
    expect(keys(s).slice(-2)).toEqual(['me:Platja de Muro', 'agent:flyingAskRuns'])
    expect(liveAttach(s)?.attach).toBe('runs')
  })

  it('a sentence that already said what they run skips the qualifier and keeps the count', () => {
    const s = run([{ type: 'beachPicked', beach, count: 80, runs: ['fnb'] }])
    expect(s.runs).toEqual(['fnb'])
    expect(s.count).toBe(80)
    expect(keys(s).slice(-2)).toEqual(['me:meBeachCount', 'agent:flying'])
  })

  it('the count opens when the shore is read, even if the qualifier was ignored', () => {
    const s = run([{ type: 'beachPicked', beach, count: null, runs: [] }, { type: 'shoreRead', snapped: true }])
    expect(s.step).toBe('count')
    expect(s.runs).toBeNull()
    expect(liveAttach(s)?.attach).toBe('count')
  })

  it('never says "facing the sea" when no shoreline turned the parcel', () => {
    const snapped = run([{ type: 'beachPicked', beach, count: 60, runs: ['fnb'] }, { type: 'shoreRead', snapped: true }])
    const manual = run([{ type: 'beachPicked', beach, count: 60, runs: ['fnb'] }, { type: 'shoreRead', snapped: false }])
    expect(snapped.msgs.at(-1)?.key).toBe('countHave')
    expect(manual.msgs.at(-1)?.key).toBe('countHaveManual')
    expect(liveAttach(manual)?.attach).toBe('count')
  })

  it('answering the qualifier is echoed, and the answer is kept', () => {
    const s = run([
      { type: 'beachPicked', beach, count: null, runs: [] },
      { type: 'runsChosen', runs: ['rentals'], echo: 'Rentals' },
      { type: 'shoreRead', snapped: true },
    ])
    expect(s.runs).toEqual(['rentals'])
    expect(keys(s)).toContain('me:Rentals')
    expect(s.step).toBe('count')
  })

  it('cannot build with no sunbeds; builds once a count is set', () => {
    const at = run([{ type: 'beachPicked', beach, count: null, runs: ['fnb'] }, { type: 'shoreRead', snapped: true }])
    expect(journeyReducer(at, { type: 'build' }).step).toBe('count')
    const s = run([{ type: 'countSet', count: 60 }, { type: 'build' }, { type: 'built', token: 'tok' }], at)
    expect(s.step).toBe('guest')
    expect(s.token).toBe('tok')
    expect(liveAttach(s)?.attach).toBe('guest')
  })

  it('a failed build returns to the count with the control live again', () => {
    const at = run([{ type: 'beachPicked', beach, count: 40, runs: ['fnb'] }, { type: 'shoreRead', snapped: true }, { type: 'build' }, { type: 'buildFailed' }])
    expect(at.step).toBe('count')
    expect(liveAttach(at)?.attach).toBe('count')
  })

  it('the guest mission books, pays and hands the booked bed to the staff mission', () => {
    const s = run([
      { type: 'bedTapped', label: 'A7', row: 0 },
      { type: 'priceSet', price: 24 },
      { type: 'reserve' },
      { type: 'paid' },
      { type: 'toStaff' },
    ], resumedJourney({ beach, count: 60, token: 'tok' }))
    expect(s.booked).toEqual(['A7'])
    expect(s.guestBed).toBe('A7')
    expect(s.msgs.find((m) => m.key === 'mePaid')?.params).toEqual({ price: 24 })
    expect(s.msgs.at(-1)?.params).toEqual({ label: 'A7' })
  })

  it('a booked bed cannot be booked again', () => {
    const s = run([{ type: 'bedTapped', label: 'A7', row: 0 }, { type: 'reserve' }, { type: 'paid' }, { type: 'bedTapped', label: 'A7', row: 0 }], resumedJourney({ beach, count: 60, token: 'tok' }))
    expect(s.step).toBe('pass')
  })

  it('only checking in the guest’s own bed completes the staff mission; examples check in quietly', () => {
    const base = run([{ type: 'bedTapped', label: 'B3', row: 1 }, { type: 'reserve' }, { type: 'paid' }, { type: 'toStaff' }], resumedJourney({ beach, count: 60, token: 'tok' }))
    const example = journeyReducer(base, { type: 'checkIn', label: 'B5' })
    expect(example.step).toBe('staff')
    expect(example.msgs.length).toBe(base.msgs.length)
    const own = journeyReducer(example, { type: 'checkIn', label: 'B3' })
    expect(own.step).toBe('checked')
    expect(liveAttach(own)?.attach).toBe('checked')
  })

  it('skipping the guest booking still has a bed for staff to check in', () => {
    const s = run([{ type: 'toStaff' }], resumedJourney({ beach, count: 60, token: 'tok' }))
    expect(s.step).toBe('staff')
    expect(s.msgs.at(-1)?.params).toEqual({ label: 'A1' })
  })

  it('free text joins the thread; a newer plain agent line retires the old attachment', () => {
    const s = run([{ type: 'say', from: 'me', text: 'do you work with beach bars?' }, { type: 'say', from: 'agent', text: 'Yes — guests can order to their sunbed.' }])
    expect(keys(s).slice(-2)).toEqual(['me:do you work with beach bars?', 'agent:Yes — guests can order to their sunbed.'])
    // free text (no key) does not retire the live attachment — the step UI stays usable
    expect(liveAttach(s)?.attach).toBe('start')
    expect(liveAttach(journeyReducer(s, { type: 'sayKey', key: 'noMatch' }))).toBeNull()
  })

  it('the beach can be changed until a mockup exists, never after', () => {
    const flying = run([{ type: 'beachPicked', beach, count: null, runs: [] }])
    expect(journeyReducer(flying, { type: 'changeBeach' }).step).toBe('beach')
    const built = resumedJourney({ beach, count: 60, token: 'tok' })
    expect(journeyReducer(built, { type: 'changeBeach' })).toBe(built)
  })

  it('ignores events that do not belong to the current step', () => {
    const s = initialJourney()
    for (const e of [{ type: 'paid' }, { type: 'reserve' }, { type: 'build' }, { type: 'checkIn', label: 'A1' }, { type: 'built', token: 'x' }] as JourneyEvent[]) {
      expect(journeyReducer(s, e)).toBe(s)
    }
  })

  it('after check-in, the modules follow what they run, then the summary, then go-live', () => {
    const muro = { ...beach, address: 'Muro, Illes Balears, Spain' }
    let s = run([{ type: 'checkIn', label: 'A1' }], run([{ type: 'toStaff' }], resumedJourney({ beach: muro, count: 60, token: 'tok', runs: ['rentals'] })))
    expect(s.step).toBe('checked')
    const seen: string[] = []
    for (let i = 0; i < 4 && s.step !== 'summary'; i++) {
      s = journeyReducer(s, { type: 'continue', echoKey: i ? 'meDone' : undefined })
      seen.push(liveAttach(s)!.attach)
    }
    expect(seen).toEqual(['mod_rental', 'mod_dayclose', 'mod_verifactu', 'summary'])
    expect(s.played).toEqual(['rental', 'dayclose', 'verifactu'])
    expect(journeyReducer(s, { type: 'toLive' }).step).toBe('live')
  })

  it('the plan is fixed once modules start — a late answer cannot reshuffle the demo', () => {
    let s = run([{ type: 'toStaff' }, { type: 'checkIn', label: 'A1' }, { type: 'continue' }], resumedJourney({ beach, count: 60, token: 'tok', runs: [] }))
    expect(s.plan).toEqual(['dayclose'])
    s = journeyReducer(s, { type: 'continue' })
    expect(s.step).toBe('summary')
  })

  it('go-live can be reached from any module (every step is skippable)', () => {
    const s = run([{ type: 'toStaff' }, { type: 'checkIn', label: 'A1' }, { type: 'continue' }, { type: 'toLive' }], resumedJourney({ beach, count: 60, token: 'tok' }))
    expect(s.step).toBe('live')
  })
})
