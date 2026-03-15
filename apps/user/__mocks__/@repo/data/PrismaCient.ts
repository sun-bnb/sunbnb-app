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
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  },
  site: {
    findUnique: vi.fn(),
  },
  product: {
    findMany: vi.fn(),
  },
  rentalItem: {
    findMany: vi.fn(),
  },
  inventoryItem: {
    findMany: vi.fn(),
  },
}

export default prisma
