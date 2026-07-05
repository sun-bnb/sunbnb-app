import { test, expect } from '../../fixtures'
// import { manageUrl, multiselect } from '../../support/manage'  // ← driving helpers, ready to use

/**
 * LAYER 0 — critical core. On-site offline ops: a partner walks in guests on the manage grid
 * and the reservation persists. The second pillar of the core loop (the offline counterpart to
 * the online happy path). The verifier-sunbnb skill documents this surface in full.
 *
 * SCAFFOLD ONLY — `test.fixme` until implemented. Needs a seeded site + SecurityToken with
 * ≥3 active seats in one parcel (see the skill's manage-page recipe / LAYERS.md).
 */
test.fixme('partner reserves walk-in seats on the manage grid (offline core)', async ({ page }) => {
  await test.step('Open the token-gated manage grid for a seeded site', async () => {
    // TODO: page.goto(manageUrl(siteId, token)) — partner :3001, ?key=<SecurityToken.id>.
  })

  await test.step('Multiselect free seats and Reserve them as a walk-in', async () => {
    // TODO: multiselect(page, ['009-1','010-1','011-1']) → "3 selected" → Reserve.
  })

  await test.step('Verify the reservations persisted (header counts + DB)', async () => {
    // TODO: header R0→R3; /db — Reservation rows linked via _InventoryItemToReservation.
  })

  await test.step('Cleanup: remove the created reservations', async () => {
    // TODO: delete rows created here.
  })

  expect(true).toBe(true) // placeholder — real assertions land with the implementation
})
