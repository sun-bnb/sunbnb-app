import { test, expect } from '../../fixtures'

/**
 * LAYER 2 — main functionality. The big secondary features that most venues use but that
 * aren't the core booking loop: F&B ordering, equipment rentals, table reservations.
 * SCAFFOLD ONLY (`test.fixme`). See LAYERS.md.
 */

test.fixme('consumer places an F&B order against a reservation', async ({ page }) => {
  // TODO: from /reservations/[id] → add products → createOrder → order COMPLETE; invoice created.
  expect(true).toBe(true)
})

test.fixme('consumer books an hourly equipment rental', async ({ page }) => {
  // TODO: site with "rentals" feature → equipment tab → pick item + hours → pay → rental booking.
  expect(true).toBe(true)
})

test.fixme('consumer makes a table reservation with a deposit', async ({ page }) => {
  // TODO: restaurant flow → pick table + shift → deposit (Mollie/demo) → table reservation confirmed.
  expect(true).toBe(true)
})
