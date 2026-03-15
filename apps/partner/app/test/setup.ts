/**
 * Integration test setup for the partner app.
 *
 * POSTGRES_URL must be set via CLI before vitest starts (module-level
 * connectionString is captured at import time). This file sets the
 * remaining env vars and exports DB utilities.
 */

process.env.RESEND_API_KEY = 'test-key'
process.env.ALLOWED_ORIGINS = 'https://test.sunbnb.app'

import prisma from '@repo/data/PrismaCient'

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
