/**
 * kind `site_fields` -- General / Content tab fields of the open site. Executed through the existing
 * `saveGeneral` (name / price / VAT), `saveContentFields` (description / services), `setSiteStatus`
 * and `setPartialGroupBooking`; this module only diffs, orders the steps and restores.
 */
import prisma from '@repo/data/PrismaCient'
import { saveGeneral, setSiteStatus, setPartialGroupBooking } from '@/app/sites/[id]/site-actions'
import { saveContentFields } from '@/app/sites/[id]/content-actions'
import { isValidSiteStatus } from '@/lib/validation'
import { ProposalError, norm, type Change, type Diff, type HandlerCtx, type KindHandler, type Scalar } from '../types'

export const SERVICE_VALUES = ['wc', 'food', 'drinks', 'rental'] as const

export interface SiteFieldsPayload {
  fields: {
    name?: string
    /** Gross, VAT-inclusive price per sunbed; null = clear (free / not set). */
    price?: number | null
    vat?: number | null
    description?: string
    services?: string[]
    status?: 'active' | 'hidden'
    partialGroupBooking?: boolean
  }
}

type Fields = SiteFieldsPayload['fields']

interface SiteRow {
  name: string
  type: string | null
  price: number | null
  vat: number | null
  locationLat: string | null
  locationLng: string | null
  description: string | null
  services: string[]
  status: string | null
  partialGroupBookingEnabled: boolean
}

async function load(siteId: string): Promise<SiteRow> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      name: true, type: true, price: true, vat: true, locationLat: true, locationLng: true,
      description: true, services: true, status: true, partialGroupBookingEnabled: true,
    },
  })
  if (!site) throw new ProposalError('Site not found')
  return { ...site, services: site.services ?? [] } as SiteRow
}

const FIELD_LABEL: Record<keyof Fields, string> = {
  name: 'Name',
  price: 'Price per sunbed (incl. VAT)',
  vat: 'VAT (%)',
  description: 'Description',
  services: 'On-site services',
  status: 'Visibility',
  partialGroupBooking: 'Allow booking part of a group',
}

const current = (row: SiteRow): Record<keyof Fields, Scalar> => ({
  name: row.name,
  price: row.price ?? null,
  vat: row.vat ?? null,
  description: row.description ?? null,
  services: row.services.join(', '),
  status: row.status ?? null,
  partialGroupBooking: row.partialGroupBookingEnabled,
})

const wanted = (f: Fields): Partial<Record<keyof Fields, Scalar>> => {
  const out: Partial<Record<keyof Fields, Scalar>> = {}
  if ('name' in f) out.name = f.name ?? null
  if ('price' in f) out.price = f.price ?? null
  if ('vat' in f) out.vat = f.vat ?? null
  if ('description' in f) out.description = f.description ?? null
  if ('services' in f) out.services = (f.services ?? []).join(', ')
  if ('status' in f) out.status = f.status ?? null
  if ('partialGroupBooking' in f) out.partialGroupBooking = f.partialGroupBooking ?? null
  return out
}

/** Same bounds as the real actions (saveGeneral / saveContentFields) -- they re-validate on apply. */
export function planSiteFields(input: Record<string, unknown>): { payload: SiteFieldsPayload } | { errors: string[] } {
  const errors: string[] = []
  const fields: Fields = {}

  if (input.name !== undefined) {
    const name = String(input.name).trim()
    if (!name) errors.push('Site name cannot be empty')
    else if (name.length > 200) errors.push('Site name is too long (max 200)')
    else fields.name = name
  }
  for (const key of ['price', 'vat'] as const) {
    if (input[key] === undefined) continue
    const n = input[key]
    const max = key === 'price' ? 100000 : 100
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max)) {
      errors.push(key === 'price' ? 'Price must be 0-100,000' : 'VAT must be 0-100')
    } else {
      // The real action stores 0 as "not set".
      fields[key] = typeof n === 'number' && n > 0 ? n : null
    }
  }
  if (input.description !== undefined) {
    const d = String(input.description)
    if (d.length > 5000) errors.push('Description is too long (max 5000 characters)')
    else fields.description = d
  }
  if (input.services !== undefined) {
    const s = input.services
    if (!Array.isArray(s) || s.some((x) => typeof x !== 'string' || !(SERVICE_VALUES as readonly string[]).includes(x))) {
      errors.push(`services must be a list of: ${SERVICE_VALUES.join(', ')}`)
    } else fields.services = [...new Set(s as string[])]
  }
  if (input.status !== undefined) {
    if (typeof input.status !== 'string' || !isValidSiteStatus(input.status)) errors.push('status must be active or hidden')
    else fields.status = input.status as 'active' | 'hidden'
  }
  if (input.partialGroupBooking !== undefined) {
    if (typeof input.partialGroupBooking !== 'boolean') errors.push('partialGroupBooking must be true or false')
    else fields.partialGroupBooking = input.partialGroupBooking
  }
  if (errors.length === 0 && Object.keys(fields).length === 0) errors.push('Nothing to change: give at least one field')
  return errors.length ? { errors } : { payload: { fields } }
}

export const siteFieldsHandler: KindHandler<SiteFieldsPayload, Fields> = {
  kind: 'site_fields',

  async diff(ctx: HandlerCtx, payload): Promise<Diff> {
    const row = await load(ctx.siteId)
    const cur = current(row)
    const want = wanted(payload.fields)
    const changes: Change[] = []
    const warnings: string[] = []
    for (const key of Object.keys(want) as (keyof Fields)[]) {
      if (norm(cur[key]) === norm(want[key])) continue
      changes.push({ target: 'Site', field: key, label: FIELD_LABEL[key], before: cur[key] ?? null, after: want[key] ?? null })
    }
    const touchesGeneral = changes.some((c) => c.field === 'name' || c.field === 'price' || c.field === 'vat')
    if (touchesGeneral && (!row.locationLat || !row.locationLng)) {
      throw new ProposalError('Set the site location on the General tab first; name, price and VAT are saved together with it')
    }
    if (changes.some((c) => c.field === 'price') && row.type === 'unpaid') {
      warnings.push('This site uses off-platform billing: no price is charged through Sunbnb, so this price is informational only')
    }
    if (changes.some((c) => c.field === 'status' && c.after === 'hidden')) {
      warnings.push('A hidden site is not shown to guests and cannot be booked')
    }
    if (changes.some((c) => c.field === 'status' && c.after === 'active')) {
      warnings.push('An active site is shown to guests and can be booked')
    }
    return { changes, ...(warnings.length ? { warnings } : {}) }
  },

  async snapshot(ctx, payload) {
    const cur = await load(ctx.siteId)
    const out: Fields = {}
    const f = payload.fields
    if ('name' in f) out.name = cur.name
    if ('price' in f) out.price = cur.price ?? null
    if ('vat' in f) out.vat = cur.vat ?? null
    if ('description' in f) out.description = cur.description ?? ''
    if ('services' in f) out.services = cur.services
    if ('status' in f) out.status = (cur.status ?? 'active') as 'active' | 'hidden'
    if ('partialGroupBooking' in f) out.partialGroupBooking = cur.partialGroupBookingEnabled
    return out
  },

  async execute(ctx, payload, done) {
    await write(ctx, payload.fields, done)
  },

  async restore(ctx, _payload, snapshot, only) {
    await write(ctx, snapshot, [], only)
  },
}

/** Apply `target` over the current row, one existing action per tab. */
async function write(ctx: HandlerCtx, target: Fields, done: string[], only?: string[]): Promise<void> {
  const run = (step: string) => !only || only.includes(step)
  const row = await load(ctx.siteId)
  const fail = (step: string, r: { status: string; errors?: string[] }) => {
    throw new ProposalError(r.errors?.[0] ?? `${step} failed`)
  }

  if (run('general') && ('name' in target || 'price' in target || 'vat' in target)) {
    const price = 'price' in target ? target.price : row.price
    const vat = 'vat' in target ? target.vat : row.vat
    const r = await saveGeneral({
      id: ctx.siteId,
      name: target.name ?? row.name,
      type: row.type ?? 'paid',
      price: price ? String(price) : '',
      vat: vat ? String(vat) : '',
      locationLat: row.locationLat ?? '',
      locationLng: row.locationLng ?? '',
    })
    if (r.status !== 'ok') fail('General settings', r)
    done.push('general')
  }
  if (run('content') && ('description' in target || 'services' in target)) {
    const r = await saveContentFields({
      id: ctx.siteId,
      description: 'description' in target ? (target.description ?? '') : (row.description ?? ''),
      services: 'services' in target ? (target.services ?? []) : row.services,
    })
    if (r.status !== 'ok') fail('Content', r)
    done.push('content')
  }
  if (run('status') && 'status' in target && target.status) {
    const r = await setSiteStatus(ctx.siteId, target.status)
    if (r.status !== 'ok') fail('Visibility', r)
    done.push('status')
  }
  if (run('partialGroupBooking') && 'partialGroupBooking' in target && typeof target.partialGroupBooking === 'boolean') {
    const r = await setPartialGroupBooking(ctx.siteId, target.partialGroupBooking)
    if (r.status !== 'ok') fail('Group booking', r)
    done.push('partialGroupBooking')
  }
}
