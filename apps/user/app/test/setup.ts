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
      -- Veri*factu (track 026). verifactu_chain has NO foreign key: it is
      -- keyed on an issuer NIF string, so the Invoice cascade does not reach
      -- it and its head would keep pointing at a record truncated by an earlier
      -- test. The record writer then refuses to file (chain head points at a
      -- record that no longer exists), which leaks as a spurious block in
      -- unrelated suites.
      "verifactu_record",
      "verifactu_chain",
      "invoice_series",
      "invoice_chain",
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
