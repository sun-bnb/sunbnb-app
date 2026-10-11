/**
 * The propose tools validate at proposal time with the SAME bounds the real actions enforce on apply.
 * If someone changes a limit in an action and not here, the user would review a proposal that can
 * never apply (or be refused one that would): these tests drive the real action and the planner over
 * the same boundary values and require them to agree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn() }))
vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('@repo/data/payment', () => ({ computeVatAndBaseAmounts: vi.fn().mockReturnValue({ baseAmount: 1, vatAmount: 0 }) }))

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { saveGeneral } from '@/app/sites/[id]/site-actions'
import { saveContentFields } from '@/app/sites/[id]/content-actions'
import { addProduct } from '@/app/sites/[id]/products/actions'
import { createRentalItem } from '@/app/sites/[id]/rentals/actions'
import { saveBrand } from '@/app/sites/[id]/site-actions'
import { proposeSiteFields } from '../tools/propose'
import { planSiteFields } from './handlers/site-fields'
import { planProducts } from './handlers/products'
import { planRentals } from './handlers/rentals'
import { planBrand } from './handlers/brand'
import { SITE, OWNER } from './test-support'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, type: 'paid', customBrandEnabled: false, customBrandKey: null, layoutMode: 'geo' } as never)
  vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE } as never)
  vi.mocked(prisma.site.update).mockResolvedValue({} as never)
  vi.mocked(prisma.product.create).mockResolvedValue({} as never)
  vi.mocked(prisma.rentalItem.create).mockResolvedValue({} as never)
  vi.mocked(prisma.siteBrand.upsert).mockResolvedValue({} as never)
  ;(prisma as any).$executeRaw = vi.fn().mockResolvedValue(1)
})

const planOk = (r: object) => !('errors' in r)
const actionOk = (r: { status: string }) => r.status === 'ok'

describe('site fields vs saveGeneral / saveContentFields', () => {
  const general = (over: Record<string, string>) =>
    saveGeneral({ id: SITE, name: 'Playa', type: 'paid', price: '9', vat: '21', locationLat: '36', locationLng: '-4', ...over })

  it.each([0, 0.01, 100000, 100001, -1])('price %s', async (price) => {
    expect(planOk(planSiteFields({ price }))).toBe(actionOk(await general({ price: String(price) })))
  })
  it.each([0, 100, 100.5, 101, -1])('vat %s', async (vat) => {
    expect(planOk(planSiteFields({ vat }))).toBe(actionOk(await general({ vat: String(vat) })))
  })
  it.each([1, 200, 201])('name length %s', async (n) => {
    const name = 'x'.repeat(n)
    expect(planOk(planSiteFields({ name }))).toBe(actionOk(await general({ name })))
  })
  it.each([4999, 5000, 5001])('description length %s', async (n) => {
    const description = 'x'.repeat(n)
    expect(planOk(planSiteFields({ description }))).toBe(actionOk(await saveContentFields({ id: SITE, description, services: [] })))
  })
  it('the services cap in the tool schema equals the action cap', async () => {
    const schema = proposeSiteFields.inputSchema.properties as Record<string, { maxItems: number }>
    const cap = schema.services!.maxItems
    expect(actionOk(await saveContentFields({ id: SITE, description: '', services: Array(cap).fill('wc') }))).toBe(true)
    expect(actionOk(await saveContentFields({ id: SITE, description: '', services: Array(cap + 1).fill('wc') }))).toBe(false)
  })
})

describe('products vs addProduct', () => {
  async function add(over: Record<string, string>) {
    const fd = new FormData()
    for (const [k, v] of Object.entries({ siteId: SITE, name: 'Mojito', totalPrice: '8', tax: '10', category: 'drink', ...over })) fd.set(k, v)
    return addProduct(fd)
  }
  it.each([0.01, 100000, 100001, 0, -1])('price %s', async (price) => {
    expect(planOk(planProducts({ upsert: [{ name: 'Mojito', price, vat: 10 }] }))).toBe(actionOk(await add({ totalPrice: String(price) })))
  })
  it.each([0, 100, 101, -1])('vat %s', async (vat) => {
    expect(planOk(planProducts({ upsert: [{ name: 'Mojito', price: 8, vat }] }))).toBe(actionOk(await add({ tax: String(vat) })))
  })
  it.each(['food', 'drink', 'snack', 'accessory', 'weapon'])('category %s', async (category) => {
    expect(planOk(planProducts({ upsert: [{ name: 'Mojito', price: 8, vat: 10, category }] }))).toBe(actionOk(await add({ category })))
  })
  it.each([200, 201])('name length %s', async (n) => {
    const name = 'x'.repeat(n)
    expect(planOk(planProducts({ upsert: [{ name, price: 8, vat: 10 }] }))).toBe(actionOk(await add({ name })))
  })
  it.each([1000, 1001])('description length %s', async (n) => {
    const description = 'x'.repeat(n)
    expect(planOk(planProducts({ upsert: [{ name: 'A', price: 8, vat: 10, description }] }))).toBe(actionOk(await add({ description })))
  })
})

describe('rental items vs createRentalItem', () => {
  const create = (over: Record<string, unknown>) =>
    createRentalItem({ siteId: SITE, name: 'Kayak', pricePerHour: 5, totalQuantity: 2, ...over } as never)
  it.each([1, 10000, 10001, 0])('quantity %s', async (totalQuantity) => {
    expect(planOk(planRentals({ upsert: [{ name: 'Kayak', pricePerHour: 5, totalQuantity }] }))).toBe(actionOk(await create({ totalQuantity })))
  })
  it.each([0.5, 100000, 100001, -1])('hourly price %s', async (pricePerHour) => {
    expect(planOk(planRentals({ upsert: [{ name: 'Kayak', pricePerHour, totalQuantity: 2 }] }))).toBe(actionOk(await create({ pricePerHour })))
  })
  it.each([1000, 1001])('description length %s', async (n) => {
    const description = 'x'.repeat(n)
    expect(planOk(planRentals({ upsert: [{ name: 'Kayak', pricePerHour: 5, totalQuantity: 2, description }] }))).toBe(actionOk(await create({ description })))
  })
})

describe('brand vs saveBrand', () => {
  const brand = (over: Record<string, string>) =>
    saveBrand({ siteId: SITE, brandName: 'Playa', slug: '', tagline: '', bgColor: '#ffffff', fgColor: '#000000', ...over })
  it.each(['#fff', '#ffffff', '#ffffffff', '#ff', 'red', '#gggggg'])('colour %s', async (bgColor) => {
    expect(planOk(planBrand({ brandName: 'Playa', bgColor }))).toBe(actionOk(await brand({ bgColor })))
  })
  it.each([500, 501])('tagline length %s', async (n) => {
    const tagline = 'x'.repeat(n)
    expect(planOk(planBrand({ brandName: 'Playa', tagline }))).toBe(actionOk(await brand({ tagline })))
  })
  it.each([200, 201])('brand name length %s', async (n) => {
    const brandName = 'x'.repeat(n)
    expect(planOk(planBrand({ brandName }))).toBe(actionOk(await brand({ brandName })))
  })
})
