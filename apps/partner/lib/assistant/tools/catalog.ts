import prisma from '@repo/data/PrismaCient'
import { capList, defineTool } from './helpers'

export const listProducts = defineTool({
  name: 'list_products',
  label: 'Reading products',
  description:
    'Food, drink and accessory products of the open site (Products tab): name, category, VAT-inclusive price, tax %, active, sold-out, prep time, whether an image is set. Optional `name` filter (contains, case-insensitive).',
  properties: { name: { type: 'string', maxLength: 80 } },
  async run(input, ctx) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const products = await prisma.product.findMany({
      where: { siteId: ctx.siteId, ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}) },
      select: { name: true, category: true, totalPrice: true, tax: true, active: true, soldOut: true, prepTime: true, imageUrl: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: 300,
    })
    const { rows, truncated, total } = capList(products, 100)
    return {
      total,
      truncated,
      products: rows.map((p) => ({
        name: p.name,
        category: p.category,
        price: p.totalPrice,
        taxPercent: p.tax,
        active: p.active,
        soldOut: p.soldOut,
        prepMinutes: p.prepTime,
        hasImage: !!p.imageUrl,
      })),
    }
  },
})

export const listRentalItems = defineTool({
  name: 'list_rental_items',
  label: 'Reading rental items',
  description:
    'Equipment rental items of the open site (Rentals tab): name, category, quantity, price per hour / per day, active, whether an image is set. Optional `name` filter.',
  properties: { name: { type: 'string', maxLength: 80 } },
  async run(input, ctx) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const items = await prisma.rentalItem.findMany({
      where: { siteId: ctx.siteId, ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}) },
      select: { name: true, category: true, totalQuantity: true, pricePerHour: true, pricePerDay: true, active: true, imageUrl: true },
      orderBy: { name: 'asc' },
      take: 300,
    })
    const { rows, truncated, total } = capList(items, 100)
    return {
      total,
      truncated,
      items: rows.map((i) => ({
        name: i.name,
        category: i.category,
        quantity: i.totalQuantity,
        pricePerHour: i.pricePerHour,
        pricePerDay: i.pricePerDay,
        active: i.active,
        hasImage: !!i.imageUrl,
      })),
    }
  },
})
