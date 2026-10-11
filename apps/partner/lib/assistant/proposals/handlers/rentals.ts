/**
 * kind `rental_items` -- the Rentals tab catalogue. Items are matched BY NAME within the site;
 * prices are per hour / per day as the venue lists them (no conversion). Executed through the
 * existing createRentalItem / updateRentalItem / deleteRentalItem (which itself refuses items that
 * have bookings -- the proposal refuses earlier so the user is told before reviewing).
 */
import prisma from '@repo/data/PrismaCient'
import { createRentalItem, updateRentalItem, deleteRentalItem } from '@/app/sites/[id]/rentals/actions'
import { ProposalError, norm, type Change, type Create, type Diff, type HandlerCtx, type KindHandler, type Remove, type Scalar } from '../types'

export interface RentalUpsert {
  name: string
  description?: string | null
  category?: string | null
  pricePerHour?: number | null
  pricePerDay?: number | null
  totalQuantity?: number
  active?: boolean
}
export interface RentalsPayload { upserts: RentalUpsert[]; deletes: string[] }
interface RentalRow {
  id: string
  name: string
  description: string | null
  category: string | null
  pricePerHour: number | null
  pricePerDay: number | null
  totalQuantity: number
  active: boolean
}
export interface RentalsSnapshot { existing: RentalRow[]; created: string[] }

const MAX_ITEMS = 30
const key = (name: string) => name.trim().toLowerCase()

export function planRentals(input: Record<string, unknown>): { payload: RentalsPayload } | { errors: string[] } {
  const errors: string[] = []
  const upsertsIn = input.upsert === undefined ? [] : input.upsert
  const deletesIn = input.delete === undefined ? [] : input.delete
  if (!Array.isArray(upsertsIn) || !Array.isArray(deletesIn)) return { errors: ['upsert and delete must be lists'] }
  if (upsertsIn.length + deletesIn.length === 0) return { errors: ['Nothing to change: give upsert and/or delete'] }
  if (upsertsIn.length > MAX_ITEMS || deletesIn.length > MAX_ITEMS) return { errors: [`At most ${MAX_ITEMS} items per proposal`] }

  const upserts: RentalUpsert[] = []
  const seen = new Set<string>()
  for (const [i, raw] of upsertsIn.entries()) {
    const p = (raw ?? {}) as Record<string, unknown>
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name || name.length > 200) { errors.push(`upsert[${i}].name is required (max 200 characters)`); continue }
    if (seen.has(key(name))) { errors.push(`"${name}" appears twice`); continue }
    seen.add(key(name))
    const u: RentalUpsert = { name }
    if (p.description !== undefined) {
      if (p.description !== null && (typeof p.description !== 'string' || p.description.length > 1000)) errors.push(`${name}: description must be at most 1000 characters`)
      else u.description = (p.description as string | null)?.trim() || null
    }
    if (p.category !== undefined) {
      if (p.category !== null && (typeof p.category !== 'string' || p.category.length > 100)) errors.push(`${name}: category must be at most 100 characters`)
      else u.category = (p.category as string | null)?.trim() || null
    }
    for (const k of ['pricePerHour', 'pricePerDay'] as const) {
      if (p[k] === undefined) continue
      const v = p[k]
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100000)) errors.push(`${name}: ${k} must be 0-100,000`)
      else u[k] = typeof v === 'number' && v > 0 ? v : null
    }
    if (p.totalQuantity !== undefined) {
      if (typeof p.totalQuantity !== 'number' || !Number.isInteger(p.totalQuantity) || p.totalQuantity < 1 || p.totalQuantity > 10000) errors.push(`${name}: totalQuantity must be 1-10,000`)
      else u.totalQuantity = p.totalQuantity
    }
    if (p.active !== undefined) {
      if (typeof p.active !== 'boolean') errors.push(`${name}: active must be true or false`)
      else u.active = p.active
    }
    upserts.push(u)
  }
  const deletes: string[] = []
  for (const [i, raw] of deletesIn.entries()) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) { errors.push(`delete[${i}] must be an item name`); continue }
    if (seen.has(key(name))) errors.push(`"${name}" is both changed and deleted`)
    deletes.push(name)
  }
  return errors.length ? { errors } : { payload: { upserts, deletes } }
}

async function loadRows(siteId: string): Promise<RentalRow[]> {
  return (await prisma.rentalItem.findMany({
    where: { siteId },
    select: { id: true, name: true, description: true, category: true, pricePerHour: true, pricePerDay: true, totalQuantity: true, active: true },
  })) as RentalRow[]
}

function find(rows: RentalRow[], name: string): RentalRow | null {
  const hits = rows.filter((r) => key(r.name) === key(name))
  if (hits.length > 1) {
    throw new ProposalError(`There are ${hits.length} rental items named "${name}". Ask the user which one, or to rename one in the Rentals tab`)
  }
  return hits[0] ?? null
}

const LABELS: Record<string, string> = {
  description: 'Description', category: 'Category', pricePerHour: 'Price per hour (incl. VAT)',
  pricePerDay: 'Price per day (incl. VAT)', totalQuantity: 'Quantity', active: 'Active',
}

export const rentalsHandler: KindHandler<RentalsPayload, RentalsSnapshot> = {
  kind: 'rental_items',

  async diff(ctx: HandlerCtx, payload, opts): Promise<Diff> {
    const rows = await loadRows(ctx.siteId)
    const changes: Change[] = []
    const creates: Create[] = []
    const deletes: Remove[] = []
    const warnings: string[] = []
    for (const u of payload.upserts) {
      const row = find(rows, u.name)
      if (!row) {
        if (u.totalQuantity === undefined) throw new ProposalError(`"${u.name}" is new: a quantity is required`)
        if (!u.pricePerHour && !u.pricePerDay) throw new ProposalError(`"${u.name}" is new: an hourly or a daily price (VAT included) is required`)
        creates.push({
          target: `Rental item "${u.name}"`,
          fields: {
            name: u.name, description: u.description ?? null, category: u.category ?? null,
            pricePerHour: u.pricePerHour ?? null, pricePerDay: u.pricePerDay ?? null, totalQuantity: u.totalQuantity,
          },
        })
        continue
      }
      const cur: Record<string, Scalar> = {
        description: row.description, category: row.category, pricePerHour: row.pricePerHour, pricePerDay: row.pricePerDay,
        totalQuantity: row.totalQuantity, active: row.active,
      }
      const start = changes.length
      for (const field of Object.keys(LABELS)) {
        const after = (u as unknown as Record<string, Scalar | undefined>)[field]
        if (after === undefined || norm(cur[field]) === norm(after)) continue
        changes.push({ target: `Rental item "${row.name}"`, field, label: LABELS[field]!, before: cur[field]!, after })
      }
      const priceAfterHour = 'pricePerHour' in u ? u.pricePerHour : row.pricePerHour
      const priceAfterDay = 'pricePerDay' in u ? u.pricePerDay : row.pricePerDay
      if (changes.length > start && !priceAfterHour && !priceAfterDay) {
        throw new ProposalError(`"${row.name}" must keep at least one price (hourly or daily)`)
      }
    }
    for (const name of payload.deletes) {
      const row = find(rows, name)
      if (!row) {
        if (opts?.applied) continue
        throw new ProposalError(`No rental item named "${name}" on this site`)
      }
      if (!opts?.applied) {
        const bookings = await prisma.rentalBooking.count({ where: { rentalItemId: row.id } })
        if (bookings > 0) throw new ProposalError(`"${row.name}" has bookings and cannot be deleted; propose deactivating it (active: false) instead`)
      }
      deletes.push({ target: `Rental item "${row.name}"`, label: 'Deleted' })
    }
    if (deletes.length) warnings.push('Deleted rental items cannot be restored by undo; they would have to be added again')
    if (!opts?.applied && (creates.length || changes.length)) {
      const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { features: true } })
      if (!site?.features?.includes('rentals')) warnings.push('Rentals are not enabled for this site yet: guests will not see these items until you enable rentals in the Rentals tab')
    }
    return { changes, ...(creates.length ? { creates } : {}), ...(deletes.length ? { deletes } : {}), ...(warnings.length ? { warnings } : {}) }
  },

  async snapshot(ctx, payload) {
    const rows = await loadRows(ctx.siteId)
    const existing: RentalRow[] = []
    const created: string[] = []
    for (const name of [...payload.upserts.map((u) => u.name), ...payload.deletes]) {
      const row = find(rows, name)
      if (row) existing.push(row)
      else created.push(name)
    }
    return { existing, created }
  },

  async execute(ctx, payload, done) {
    const check = (r: { status: string; errors?: string[] }, what: string) => {
      if (r.status !== 'ok') throw new ProposalError(`${what}: ${r.errors?.[0] ?? 'failed'}`)
    }
    for (const u of payload.upserts) {
      const row = find(await loadRows(ctx.siteId), u.name)
      if (row) {
        check(await updateRentalItem({
          id: row.id,
          siteId: ctx.siteId,
          name: row.name,
          description: ('description' in u ? u.description : row.description) ?? undefined,
          category: ('category' in u ? u.category : row.category) ?? undefined,
          pricePerHour: ('pricePerHour' in u ? u.pricePerHour : row.pricePerHour) ?? undefined,
          pricePerDay: ('pricePerDay' in u ? u.pricePerDay : row.pricePerDay) ?? undefined,
          totalQuantity: u.totalQuantity ?? row.totalQuantity,
          active: u.active ?? row.active,
        }), u.name)
      } else {
        check(await createRentalItem({
          siteId: ctx.siteId,
          name: u.name,
          description: u.description ?? undefined,
          category: u.category ?? undefined,
          pricePerHour: u.pricePerHour ?? undefined,
          pricePerDay: u.pricePerDay ?? undefined,
          totalQuantity: u.totalQuantity ?? 1,
        }), u.name)
      }
      done.push(`rental:${u.name}`)
    }
    for (const name of payload.deletes) {
      const row = find(await loadRows(ctx.siteId), name)
      if (row) check(await deleteRentalItem(ctx.siteId, row.id), name)
      done.push(`delete:${name}`)
    }
  },

  async undoBlocker(ctx, _payload, snapshot) {
    const rows = await loadRows(ctx.siteId)
    for (const name of snapshot.created) {
      const row = rows.find((r) => key(r.name) === key(name))
      if (!row) continue
      const bookings = await prisma.rentalBooking.count({ where: { rentalItemId: row.id } })
      if (bookings > 0) return `"${name}" already has bookings, so it cannot be removed; deactivate it instead`
    }
    return null
  },

  async restore(ctx, payload, snapshot, only) {
    const check = (r: { status: string; errors?: string[] }, what: string) => {
      if (r.status !== 'ok') throw new ProposalError(`${what}: ${r.errors?.[0] ?? 'failed'}`)
    }
    const deleted = new Set(payload.deletes.map(key))
    for (const prior of snapshot.existing) {
      if (deleted.has(key(prior.name))) continue
      if (only && !only.includes(`rental:${prior.name}`)) continue
      const row = (await loadRows(ctx.siteId)).find((r) => r.id === prior.id)
      if (!row) continue
      check(await updateRentalItem({
        id: prior.id, siteId: ctx.siteId, name: prior.name,
        description: prior.description ?? undefined, category: prior.category ?? undefined,
        pricePerHour: prior.pricePerHour ?? undefined, pricePerDay: prior.pricePerDay ?? undefined,
        totalQuantity: prior.totalQuantity, active: prior.active,
      }), prior.name)
    }
    for (const name of snapshot.created) {
      if (only && !only.includes(`rental:${name}`)) continue
      const row = (await loadRows(ctx.siteId)).find((r) => key(r.name) === key(name))
      if (row) check(await deleteRentalItem(ctx.siteId, row.id), name)
    }
  },
}
