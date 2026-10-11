/**
 * kind `working_hours` -- the General tab's booking hours. One `SiteWorkingHours` row per time range;
 * days are 1..7 = Mon..Sun in the UI (a stray 0 is read as Sunday). The payload lists the days to
 * REPLACE (their whole set of ranges; `ranges: []` = closed); days not listed are untouched.
 * Executed through the existing add / update / delete working-hours actions.
 */
import prisma from '@repo/data/PrismaCient'
import { addWorkingHours, updateWorkingHours, deleteWorkingHours } from '@/app/sites/[id]/working-hours-actions'
import { ProposalError, type Change, type Diff, type HandlerCtx, type KindHandler } from '../types'

export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_ALIASES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
}

export interface Range { open: string; close: string }
export interface WorkingHoursPayload {
  days: { day: number; ranges: Range[] }[]
}
export interface HoursSnapshot {
  days: { day: number; ranges: Range[] }[]
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function planWorkingHours(input: Record<string, unknown>): { payload: WorkingHoursPayload } | { errors: string[] } {
  const week = input.week
  if (!Array.isArray(week) || week.length === 0) return { errors: ['week must list at least one day'] }
  const errors: string[] = []
  const byDay = new Map<number, Range[]>()
  const seenClosed = new Set<number>()
  for (const [i, entry] of week.entries()) {
    const e = (entry ?? {}) as Record<string, unknown>
    const day = typeof e.day === 'string' ? DAY_ALIASES[e.day.trim().toLowerCase()] : typeof e.day === 'number' ? e.day : undefined
    if (!day || day < 1 || day > 7) {
      errors.push(`week[${i}].day must be Mon..Sun`)
      continue
    }
    if (e.closed === true) {
      if (byDay.has(day)) errors.push(`${DAY_SHORT[day]} is given as both open and closed`)
      seenClosed.add(day)
      byDay.set(day, [])
      continue
    }
    if (seenClosed.has(day)) {
      errors.push(`${DAY_SHORT[day]} is given as both open and closed`)
      continue
    }
    const open = e.open
    const close = e.close
    if (typeof open !== 'string' || typeof close !== 'string' || !HHMM.test(open) || !HHMM.test(close)) {
      errors.push(`${DAY_SHORT[day]}: open and close must be HH:MM (24 h)`)
      continue
    }
    if (open >= close) {
      errors.push(`${DAY_SHORT[day]}: close must be after open (overnight ranges are not supported)`)
      continue
    }
    byDay.set(day, [...(byDay.get(day) ?? []), { open, close }])
  }
  // Overlapping ranges on one day make no sense for booking hours.
  for (const [day, ranges] of byDay) {
    const sorted = [...ranges].sort((a, b) => a.open.localeCompare(b.open))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.open < sorted[i - 1]!.close) errors.push(`${DAY_SHORT[day]}: time ranges overlap`)
    }
  }
  if (errors.length) return { errors }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, ranges]) => ({
    day,
    ranges: [...ranges].sort((a, b) => a.open.localeCompare(b.open)),
  }))
  return { payload: { days } }
}

interface Row { id: string; day: number; openTime: Date; closeTime: Date }
const hhmm = (d: Date) => d.toISOString().slice(11, 16)
const normDay = (d: number) => (d === 0 ? 7 : d)

async function loadRows(siteId: string): Promise<Row[]> {
  return prisma.siteWorkingHours.findMany({
    where: { siteId },
    select: { id: true, day: true, openTime: true, closeTime: true },
    orderBy: { day: 'asc' },
  })
}

const rowsFor = (rows: Row[], day: number): Row[] =>
  rows.filter((r) => normDay(r.day) === day).sort((a, b) => hhmm(a.openTime).localeCompare(hhmm(b.openTime)))

const show = (ranges: Range[]): string => (ranges.length ? ranges.map((r) => `${r.open}-${r.close}`).join(', ') : 'closed')

export const workingHoursHandler: KindHandler<WorkingHoursPayload, HoursSnapshot> = {
  kind: 'working_hours',

  async diff(ctx: HandlerCtx, payload): Promise<Diff> {
    const rows = await loadRows(ctx.siteId)
    const changes: Change[] = []
    for (const { day, ranges } of payload.days) {
      const before = rowsFor(rows, day).map((r) => ({ open: hhmm(r.openTime), close: hhmm(r.closeTime) }))
      if (show(before) === show(ranges)) continue
      changes.push({
        target: `Hours ${DAY_SHORT[day]}`,
        field: 'ranges',
        label: 'Opening hours',
        before: show(before),
        after: show(ranges),
      })
    }
    return { changes }
  },

  async snapshot(ctx, payload) {
    const rows = await loadRows(ctx.siteId)
    return {
      days: payload.days.map(({ day }) => ({
        day,
        ranges: rowsFor(rows, day).map((r) => ({ open: hhmm(r.openTime), close: hhmm(r.closeTime) })),
      })),
    }
  },

  async execute(ctx, payload, done) {
    for (const { day, ranges } of payload.days) {
      await reconcileDay(ctx.siteId, day, ranges, done)
    }
  },

  async restore(ctx, _payload, snapshot, only) {
    for (const { day, ranges } of snapshot.days) {
      if (only && !only.includes(`hours:${DAY_SHORT[day]}`)) continue
      await reconcileDay(ctx.siteId, day, ranges, [])
    }
  },
}

/** Make `day`'s stored ranges equal `target`: update in place, add the extras, delete the surplus. */
async function reconcileDay(siteId: string, day: number, target: Range[], done: string[]): Promise<void> {
  const existing = rowsFor(await loadRows(siteId), day)
  // Registered BEFORE the calls: a day that fails halfway is still rolled back.
  done.push(`hours:${DAY_SHORT[day]}`)
  const check = (r: { status: string; errors?: string[] }) => {
    if (r.status !== 'ok') throw new ProposalError(r.errors?.[0] ?? 'Working hours update failed')
  }
  for (let i = 0; i < target.length; i++) {
    const want = target[i]!
    const row = existing[i]
    if (row) {
      if (hhmm(row.openTime) === want.open && hhmm(row.closeTime) === want.close) continue
      check(await updateWorkingHours(row.id, { openTime: want.open, closeTime: want.close }))
    } else {
      check(await addWorkingHours(siteId, { day: String(day), openTime: want.open, closeTime: want.close }))
    }
  }
  for (const row of existing.slice(target.length)) check(await deleteWorkingHours(row.id))
}
