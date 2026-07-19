/**
 * Integration test setup — runs before all integration test files.
 *
 * Sets POSTGRES_URL to the test database so the Prisma singleton
 * connects there instead of the dev database.
 */

// Must be set before any prisma import
process.env.POSTGRES_URL = 'postgres://postgres:sunbnb@localhost:5432/sunbnb_test'
process.env.ALLOWED_ORIGINS = 'https://test.sunbnb.app'
process.env.RESEND_API_KEY = 'test-key'
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'integration-test-auth-secret'

import prisma from '../../index'

/** The only database cleanDatabase() is ever allowed to TRUNCATE. */
const TEST_DB_NAME = 'sunbnb_test'

/**
 * Refuse to truncate anything but the dedicated local integration DB.
 *
 * This is a connection-level guard (it asks the server `current_database()`),
 * so it holds regardless of how POSTGRES_URL was resolved — a bare `vitest`
 * run, an IDE test runner, or a `source .env.local` that leaked a dev/test/prod
 * URL. It is the backstop that makes wiping the dev, test, or production
 * database impossible. See `.claude/rules/` and the incident that motivated it.
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

/**
 * Truncate all application tables (CASCADE handles FK ordering).
 * Call in beforeEach to get a clean slate per test.
 */
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
      "impersonation_log",
      "table_waitlist_entry",
      "table_reservation",
      "table_combination",
      "layout_element",
      "menu_item",
      "restaurant_hours",
      "restaurant_shift",
      "table_tab",
      "restaurant_table",
      "restaurant",
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
