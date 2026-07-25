import { vi } from 'vitest'

const prisma = {
  reservation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  order: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  rentalBooking: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  },
  site: {
    findUnique: vi.fn(),
  },
  restaurant: {
    findUnique: vi.fn(),
  },
  product: {
    findMany: vi.fn(),
  },
  menuItem: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  rentalItem: {
    findMany: vi.fn(),
  },
  inventoryItem: {
    findMany: vi.fn(),
  },
  sunbedGroup: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  tableReservation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  table: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  tableTab: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  featureFlag: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  impersonationLog: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg)
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma)
    return Promise.resolve(arg)
  }),
}

export default prisma
