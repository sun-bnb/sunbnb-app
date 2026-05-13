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

/**
 * Truncate all application tables (CASCADE handles FK ordering).
 * Call in beforeEach to get a clean slate per test.
 */
export async function cleanDatabase() {
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
