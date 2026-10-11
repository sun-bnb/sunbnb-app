/**
 * kind `products` -- the Products tab menu. Products are matched BY NAME within the site (the model
 * never sees ids); an ambiguous name is an error that asks the user to disambiguate. Prices are the
 * gross VAT-inclusive `totalPrice`; the net amount is derived by the existing `addProduct` /
 * `updateProduct` (computeVatAndBaseAmounts) -- nothing here does money arithmetic.
 * Executed through addProduct / updateProduct / toggleProductSoldOut / deleteProduct (a soft delete).
 */
import prisma from '@repo/data/PrismaCient'
import { addProduct, updateProduct, toggleProductSoldOut, deleteProduct } from '@/app/sites/[id]/products/actions'
import { isValidProductCategory } from '@/lib/validation'
import { ProposalError, norm, type Change, type Create, type Diff, type HandlerCtx, type KindHandler, type Remove, type Scalar } from '../types'

export interface ProductUpsert {
  name: string
  description?: string | null
  /** Gross, VAT-inclusive. */
  price?: number
  /** Tax percent. */
  vat?: number
  category?: string
  soldOut?: boolean
}
export interface ProductsPayload {
  upserts: ProductUpsert[]
  deletes: string[]
}
interface ProductRow {
  id: string
  name: string
  description: string | null
  totalPrice: number
  tax: number
  category: string | null
  soldOut: boolean
}
export interface ProductsSnapshot {
  /** Products that existed (and are updated or removed) -- restorable values. */
  existing: ProductRow[]
  /** Names that did not exist before the apply (created by it). */
  created: string[]
}

export const MAX_ITEMS = 30
const key = (name: string) => name.trim().toLowerCase()

export function planProducts(input: Record<string, unknown>): { payload: ProductsPayload } | { errors: string[] } {
  const errors: string[] = []
  const upsertsIn = input.upsert === undefined ? [] : input.upsert
  const deletesIn = input.delete === undefined ? [] : input.delete
  if (!Array.isArray(upsertsIn) || !Array.isArray(deletesIn)) return { errors: ['upsert and delete must be lists'] }
  if (upsertsIn.length + deletesIn.length === 0) return { errors: ['Nothing to change: give upsert and/or delete'] }
  if (upsertsIn.length > MAX_ITEMS || deletesIn.length > MAX_ITEMS) return { errors: [`At most ${MAX_ITEMS} products per proposal`] }

  const upserts: ProductUpsert[] = []
  const seen = new Set<string>()
  for (const [i, raw] of upsertsIn.entries()) {
    const p = (raw ?? {}) as Record<string, unknown>
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name || name.length > 200) { errors.push(`upsert[${i}].name is required (max 200 characters)`); continue }
    if (seen.has(key(name))) { errors.push(`"${name}" appears twice`); continue }
    seen.add(key(name))
    const u: ProductUpsert = { name }
    if (p.description !== undefined) {
      if (p.description !== null && (typeof p.description !== 'string' || p.description.length > 1000)) errors.push(`${name}: description must be text of at most 1000 characters`)
      else u.description = (p.description as string | null)?.trim() || null
    }
    if (p.price !== undefined) {
      if (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price <= 0 || p.price > 100000) errors.push(`${name}: price must be a positive number (max 100,000), VAT included`)
      else u.price = p.price
    }
    if (p.vat !== undefined) {
      if (typeof p.vat !== 'number' || !Number.isFinite(p.vat) || p.vat < 0 || p.vat > 100) errors.push(`${name}: VAT must be between 0 and 100`)
      else u.vat = p.vat
    }
    if (p.category !== undefined) {
      if (typeof p.category !== 'string' || !isValidProductCategory(p.category)) errors.push(`${name}: category must be food, drink, snack or accessory`)
      else u.category = p.category
    }
    if (p.soldOut !== undefined) {
      if (typeof p.soldOut !== 'boolean') errors.push(`${name}: soldOut must be true or false`)
      else u.soldOut = p.soldOut
    }
    upserts.push(u)
  }
  const deletes: string[] = []
  for (const [i, raw] of deletesIn.entries()) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) { errors.push(`delete[${i}] must be a product name`); continue }
    if (seen.has(key(name))) errors.push(`"${name}" is both changed and deleted`)
    deletes.push(name)
  }
  return errors.length ? { errors } : { payload: { upserts, deletes } }
}

async function loadActive(siteId: string): Promise<ProductRow[]> {
  const rows = await prisma.product.findMany({
    where: { siteId, active: true },
    select: { id: true, name: true, description: true, totalPrice: true, tax: true, category: true, soldOut: true },
  })
  return rows as ProductRow[]
}

/** The single active product with this name, null if none; throws a disambiguation error if several. */
function find(rows: ProductRow[], name: string): ProductRow | null {
  const hits = rows.filter((r) => key(r.name) === key(name))
  if (hits.length > 1) {
    const list = hits.map((h) => `${h.name} (${h.totalPrice})`).join(' / ')
    throw new ProposalError(`There are ${hits.length} products named "${name}" (${list}). Ask the user which one, or to rename one of them in the Products tab`)
  }
  return hits[0] ?? null
}

export const productsHandler: KindHandler<ProductsPayload, ProductsSnapshot> = {
  kind: 'products',

  async diff(ctx: HandlerCtx, payload, opts): Promise<Diff> {
    const rows = await loadActive(ctx.siteId)
    const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { vat: true } })
    const changes: Change[] = []
    const creates: Create[] = []
    const deletes: Remove[] = []
    const warnings: string[] = []

    for (const u of payload.upserts) {
      const row = find(rows, u.name)
      const target = `Product "${row?.name ?? u.name}"`
      if (!row) {
        if (u.price === undefined) throw new ProposalError(`"${u.name}" is new: a price (VAT included) is required`)
        const vat = u.vat ?? site?.vat ?? undefined
        if (vat === undefined || vat === null) throw new ProposalError(`"${u.name}" is new and the site has no VAT rate: ask the user which VAT percent applies`)
        if (u.soldOut) throw new ProposalError(`"${u.name}" is new: create it first, then mark it sold out`)
        creates.push({
          target,
          fields: {
            name: u.name, price: u.price, vat, category: u.category ?? 'food', description: u.description ?? null,
          },
        })
        continue
      }
      const cur: Record<string, Scalar> = {
        description: row.description, price: row.totalPrice, vat: row.tax, category: row.category ?? 'food', soldOut: row.soldOut,
      }
      const want: Record<string, Scalar | undefined> = {
        description: u.description, price: u.price, vat: u.vat, category: u.category, soldOut: u.soldOut,
      }
      const labels: Record<string, string> = {
        description: 'Description', price: 'Price (incl. VAT)', vat: 'VAT (%)', category: 'Category', soldOut: 'Sold out',
      }
      for (const field of Object.keys(want)) {
        if (want[field] === undefined || norm(cur[field]) === norm(want[field])) continue
        changes.push({ target, field, label: labels[field]!, before: cur[field]!, after: want[field]! })
      }
    }
    for (const name of payload.deletes) {
      const row = find(rows, name)
      if (!row) {
        if (opts?.applied) continue
        throw new ProposalError(`No product named "${name}" on this site`)
      }
      deletes.push({ target: `Product "${row.name}"`, label: 'Removed from the menu' })
    }
    if (deletes.length) warnings.push('Removed products cannot be restored by undo; they would have to be added again')
    return { changes, ...(creates.length ? { creates } : {}), ...(deletes.length ? { deletes } : {}), ...(warnings.length ? { warnings } : {}) }
  },

  async snapshot(ctx, payload) {
    const rows = await loadActive(ctx.siteId)
    const names = [...payload.upserts.map((u) => u.name), ...payload.deletes]
    const existing: ProductRow[] = []
    const created: string[] = []
    for (const name of names) {
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
    const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { vat: true } })
    // Updates and creates first, deletes last: a failure never leaves a half-deleted menu.
    for (const u of payload.upserts) {
      const row = find(await loadActive(ctx.siteId), u.name)
      // Registered BEFORE the calls: a product whose second call fails is still rolled back.
      done.push(`product:${u.name}`)
      if (row) {
        const data: Parameters<typeof updateProduct>[1] = {}
        if (u.description !== undefined && norm(u.description) !== norm(row.description)) data.description = u.description
        if (u.price !== undefined && u.price !== row.totalPrice) data.totalPrice = u.price
        if (u.vat !== undefined && u.vat !== row.tax) data.tax = u.vat
        if (u.category !== undefined && u.category !== (row.category ?? 'food')) data.category = u.category
        if (Object.keys(data).length) check(await updateProduct(row.id, data), u.name)
        if (u.soldOut !== undefined && u.soldOut !== row.soldOut) check(await toggleProductSoldOut(row.id, u.soldOut), u.name)
      } else {
        const fd = new FormData()
        fd.set('siteId', ctx.siteId)
        fd.set('name', u.name)
        if (u.description) fd.set('description', u.description)
        fd.set('totalPrice', String(u.price ?? ''))
        fd.set('tax', String(u.vat ?? site?.vat ?? ''))
        fd.set('category', u.category ?? 'food')
        check(await addProduct(fd), u.name)
      }
    }
    for (const name of payload.deletes) {
      const row = find(await loadActive(ctx.siteId), name)
      if (row) check(await deleteProduct(row.id), name)
      done.push(`delete:${name}`)
    }
  },

  async undoBlocker(ctx, _payload, snapshot) {
    const rows = await loadActive(ctx.siteId)
    for (const name of snapshot.created) {
      const row = rows.find((r) => key(r.name) === key(name))
      if (!row) continue
      const used = await prisma.orderItem.count({ where: { productId: row.id } })
      if (used > 0) return `"${name}" already has orders, so it cannot be removed; mark it sold out instead`
    }
    return null
  },

  async restore(ctx, payload, snapshot, only) {
    const check = (r: { status: string; errors?: string[] }, what: string) => {
      if (r.status !== 'ok') throw new ProposalError(`${what}: ${r.errors?.[0] ?? 'failed'}`)
    }
    const deleted = new Set(payload.deletes.map(key))
    for (const prior of snapshot.existing) {
      if (deleted.has(key(prior.name))) continue // soft-deleted rows are not restorable
      if (only && !only.includes(`product:${prior.name}`)) continue
      const row = (await loadActive(ctx.siteId)).find((r) => r.id === prior.id)
      if (!row) continue
      check(await updateProduct(prior.id, {
        description: prior.description, totalPrice: prior.totalPrice, tax: prior.tax, category: prior.category ?? 'food',
      }), prior.name)
      if (row.soldOut !== prior.soldOut) check(await toggleProductSoldOut(prior.id, prior.soldOut), prior.name)
    }
    for (const name of snapshot.created) {
      if (only && !only.includes(`product:${name}`)) continue
      const row = (await loadActive(ctx.siteId)).find((r) => key(r.name) === key(name))
      if (row) check(await deleteProduct(row.id), name)
    }
  },
}
