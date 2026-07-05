import { test, expect } from '../../fixtures'

/**
 * LAYER 0 — critical core. The headline end-to-end loop of the whole marketplace:
 * a partner signs up, stands up a beach with bookable inventory, and a consumer
 * discovers it, books a sunbed, and pays. If this passes, the core product works.
 *
 * SCAFFOLD ONLY — `test.fixme` keeps it reported as skipped until implemented. The steps
 * below are the intended flow, not yet driven. Implement with the verifier-sunbnb skill's
 * mechanics (handle.mjs → ported in support/) and confirm state with the /db skill.
 *
 * Spans BOTH apps: partner :3001 (create beach) and user :3002 (book). Implementing this
 * means adding the partner app as a second webServer entry in playwright.config.ts and
 * resolving the open questions in LAYERS.md (partner Google-OAuth auth, demo payment, seed/cleanup).
 */
test.fixme(
  'partner signs up, configures a beach, consumer books it (full happy path)',
  async ({ page }) => {
    await test.step('Partner: establish an authenticated session', async () => {
      // TODO: partner auth is Google OAuth only — use a seeded partner user or an OAuth
      // test identity / auth bypass. Decide the strategy first (LAYERS.md → open questions).
    })

    await test.step('Partner: create a site (beach) via the 4-step create wizard', async () => {
      // TODO: drive partner /sites/create (location → settings → content → done).
      // Capture the new siteId for later steps + cleanup.
    })

    await test.step('Partner: add bookable sunbed inventory to the site', async () => {
      // TODO: place active InventoryItems (inventory editor or direct seed); ensure ≥1 active seat.
    })

    await test.step('Partner: publish the site so it is discoverable', async () => {
      // TODO: set site status active; verify it surfaces via consumer discovery (/api/sites).
    })

    await test.step('Consumer: discover the beach and select a sunbed + dates', async () => {
      // TODO: user app /sites → open the new site → pick a seat + date range in the reservation panel.
    })

    await test.step('Consumer: pay in demo mode and reach the confirmation', async () => {
      // TODO: demo payment path → /payment/complete?payment_intent=pi_demo_… → reservation COMPLETE.
    })

    await test.step('Verify in DB: reservation COMPLETE + agent-model invoices exist', async () => {
      // TODO: /db — Reservation row is COMPLETE for the chosen seat; a PARTNER (gross) invoice
      // and a separate PLATFORM (commission) invoice were created. They do NOT sum to the total.
    })

    await test.step('Cleanup: delete the site / reservation / invoices created here', async () => {
      // TODO: remove every row this test created — don't litter the dev DB.
    })

    expect(true).toBe(true) // placeholder — real assertions land with the implementation
  },
)
