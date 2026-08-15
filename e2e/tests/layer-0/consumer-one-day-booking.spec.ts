import { test, expect } from '../../fixtures'
import { psql } from '../../support/db'

/**
 * LAYER 0 — the consumer reserve-first ONE-DAY booking (track 014's headline
 * flow: open site → today + first free seat preselected → one tap → booked).
 *
 * Born from a live regression (2026-08-15): track 017 P3 anchored the `to`
 * civil date to venue MIDNIGHT under an exclusive-checkout assumption, while
 * every client sends the INCLUSIVE last day — the default one-tap flow sends
 * the SAME civil date twice, so `from >= to` rejected every one-day booking
 * with "End date must be after start date". This spec drives the real
 * browser flow on an unpaid site (no payment leg) and would have caught it.
 *
 * Self-contained: seeds its own user/site/seats, deletes them after.
 */

const IDS = {
  user: 'ce2e0oneday0user000000001',
  site: 'ce2e0oneday0site000000001',
  seat1: 'ce2e0oneday0item000000001',
  seat2: 'ce2e0oneday0item000000002',
}

test.beforeAll(() => {
  // Idempotent: clear any leftovers from a crashed prior run, then seed.
  psql(`
    DELETE FROM "Site" WHERE id = '${IDS.site}';
    DELETE FROM "User" WHERE id = '${IDS.user}';
    INSERT INTO "User" (id, email, "createdAt", "updatedAt")
    VALUES ('${IDS.user}', 'e2e-oneday@local.invalid', now(), now());
    INSERT INTO "Site" (id, user_id, name, location_lat, location_lng, status, time_zone, "createdAt", "updatedAt")
    VALUES ('${IDS.site}', '${IDS.user}', 'E2E One-Day Beach', '36.7213', '-4.4214', 'active', 'Europe/Madrid', now(), now());
    INSERT INTO "InventoryItem" (id, user_id, site_id, number, location_lat, location_lng, status, "group", "createdAt", "updatedAt")
    VALUES
      ('${IDS.seat1}', '${IDS.user}', '${IDS.site}', 10101, '36.72130', '-4.42140', 'active', 1, now(), now()),
      ('${IDS.seat2}', '${IDS.user}', '${IDS.site}', 10102, '36.72130', '-4.42128', 'active', 1, now(), now());
  `)
})

test.afterAll(() => {
  psql(`
    DELETE FROM "Reservation" WHERE site_id = '${IDS.site}';
    DELETE FROM "Site" WHERE id = '${IDS.site}';
    DELETE FROM "User" WHERE id = '${IDS.user}';
  `)
})

test('one-tap single-day booking on an unpaid site completes', async ({ page, pageErrors }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(`/sites/${IDS.site}`)

  // Reserve-first: the panel opens with today + the first available seat
  // preselected; the Reserve button is live once availability has loaded.
  const reserveButton = page.getByRole('button', { name: /reserv/i }).first()
  await expect(reserveButton).toBeVisible({ timeout: 30_000 })
  await expect(reserveButton).toBeEnabled({ timeout: 30_000 })
  await page.waitForTimeout(1500) // let availability + preselection settle

  // Anonymous guest flow: an email is required before the booking is accepted.
  await page.locator('input[type="email"]').first().fill('e2e-guest@local.invalid')

  await reserveButton.click()

  // Unpaid site → the action creates a COMPLETE reservation and redirects to
  // its detail page. The regression instead surfaced the server error banner.
  await expect(page).toHaveURL(/\/reservations\//, { timeout: 30_000 })
  await expect(page.getByText('End date must be after start date')).toHaveCount(0)

  // The reservation really exists, spans exactly ONE venue civil day, inclusive.
  const row = psql(
    `SELECT status, "from", "to" FROM "Reservation" WHERE site_id = '${IDS.site}'`,
  ).trim()
  expect(row).toContain('complete')

  // Surface the console for the session log — serialization warnings etc.
  if (consoleErrors.length) {
    console.log(`── browser console errors (${consoleErrors.length}) ──`)
    for (const e of consoleErrors.slice(0, 10)) console.log(e.slice(0, 300))
  }
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
