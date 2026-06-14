/**
 * Integration test setup for the user app.
 *
 * POSTGRES_URL must be set via CLI before vitest starts (module-level
 * connectionString is captured at import time). This file sets the
 * remaining env vars and exports DB utilities.
 */

process.env.RESEND_API_KEY = 'test-key'
process.env.ALLOWED_ORIGINS = 'https://test.sunbnb.app'

import prisma from '@repo/data/PrismaCient'

/** The only database cleanDatabase() is ever allowed to TRUNCATE. */
const TEST_DB_NAME = 'sunbnb_test'

/**
 * Refuse to truncate anything but the dedicated local integration DB.
 *
 * Connection-level guard (asks the server `current_database()`), so it holds
 * regardless of how POSTGRES_URL was resolved — a bare `vitest` run, an IDE
 * test runner, or a `source .env.local` that leaked a dev/test/prod URL. This
 * is the backstop that makes wiping the dev, test, or production database
 * impossible.
 */
async function assertTestDatabase() {
  const rows = await prisma.$queryRawUnsafe<Array<{ db: string }>>(`SELECT current_database() AS db`)
  const db = rows[0]?.db
  if (db !== TEST_DB_NAME) {
    throw new Error(
      `cleanDatabase() refused to run: connected to database "${db}", not the integration ` +
        `test database "${TEST_DB_NAME}". Run integration tests via "npm run test:integration". ` +
        `This guard prevents TRUNCATE from wiping a dev, test, or production database.`
    )
  }
}

export async function cleanDatabase() {
  await assertTestDatabase()
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "InvoiceLine",
      "Invoice",
      "OrderItem",
      "Order",
      "Reservation",
      "RentalBooking",
      "RentalItem",
      "Product",
      "InventoryItem",
      "ItemGroup",
      "ServiceFee",
      "Settings",
      "Subscription",
      "SubscriptionPlan",
      "password_reset_token",
      "PartnerAccount",
      "Settlement",
      "SiteBrand",
      "SiteWorkingHours",
      "SecurityToken",
      "Site",
      "Account",
      "Session",
      "Authenticator",
      "AdminUser",
      "User"
    CASCADE
  `)
}

export async function disconnectDatabase() {
  await prisma.$disconnect()
}

export { prisma }
