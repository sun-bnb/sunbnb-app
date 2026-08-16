import { vi } from 'vitest'

const prisma = {
  site: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  reservation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  order: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  inventoryItem: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  product: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  rentalBooking: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
  },
  rentalItem: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  partnerAccount: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  siteBrand: {
    upsert: vi.fn(),
  },
  subscription: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  subscriptionPlan: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  customSubscription: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  layoutElement: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  itemGroup: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  // HW device binding (track 019 P2). No partner surface reads these yet — P4
  // (field binding on /manage) and P5 (device health list) will; stubbed now
  // because mock-contract.test.ts requires a delegate for every real model.
  device: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  deviceSeat: {
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  sunbedGroup: {
    create: vi.fn(),
    // createManyAndReturn preserves input order (assignChairPairings maps
    // minted groups back to pairs by index) — default mirrors that contract.
    createManyAndReturn: vi.fn((args: { data: unknown[] }) =>
      Promise.resolve((args?.data ?? []).map((_, i) => ({ id: `sunbed-group-${i}` })))),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  restaurant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  restaurantHours: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  table: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  menuItem: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  siteWorkingHours: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tableReservation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  tableTab: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  restaurantShift: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  tableCombination: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tableWaitlistEntry: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  accountFeatureFlag: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
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
  securityToken: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  employee: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  tillClose: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  tillEntry: {
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
  },
  // ── Models not directly used by partner-app server actions but required for
  // the mock-contract superset assertion (mock must cover every Prisma model). ──
  reservationDay: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  settings: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  serviceCode: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  serviceFee: {
    findMany: vi.fn(),
  },
  paymentProcessingFee: {
    findMany: vi.fn(),
  },
  passwordResetToken: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  account: {
    findMany: vi.fn(),
  },
  orderItem: {
    findMany: vi.fn(),
  },
  invoice: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  settlement: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  invoiceLine: {
    createMany: vi.fn(),
    findMany: vi.fn(),
  },
  session: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  verificationToken: {
    findMany: vi.fn(),
  },
  authenticator: {
    findMany: vi.fn(),
  },
  adminUser: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  // spatial_ref_sys is a PostGIS system table exposed by Prisma; partner app
  // never queries it via the client (uses $queryRawUnsafe for spatial ops).
  spatial_ref_sys: {
    findMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  $queryRaw: vi.fn(),
  $transaction: vi.fn((arg) => {
    if (Array.isArray(arg)) return Promise.all(arg)
    if (typeof arg === 'function') return arg(prisma)
    return Promise.resolve(arg)
  }),
}

export default prisma
