# E2E test layers

The e2e suite is graded into **4 layers by criticality**, plus a boot **smoke** precondition.
Each layer is a Playwright **project** backed by a directory under `tests/`. Run a layer in
isolation, run the critical gate, or run everything — failures are localized to a layer.

| Layer | Project | Directory | Scope | npm script |
|---|---|---|---|---|
| — | `smoke` | `tests/smoke.spec.ts` | App boots & renders (precondition) | `npm run e2e:smoke` |
| **0** | `layer-0` | `tests/layer-0/` | **Most essential critical core** — a few must-pass tests | `npm run e2e:l0` |
| 1 | `layer-1` | `tests/layer-1/` | Rest of core functionality | `npm run e2e:l1` |
| 2 | `layer-2` | `tests/layer-2/` | Main functionality (big secondary features) | `npm run e2e:l2` |
| 3 | `layer-3` | `tests/layer-3/` | The rest (peripheral / long-tail) | `npm run e2e:l3` |

- **Critical gate:** `npm run e2e:critical` runs `smoke` + `layer-0` — the must-stay-green set.
- **Everything:** `npm run e2e` runs all projects.
- **Cumulative ("up to layer N"):** compose projects, e.g.
  `npx playwright test --project=smoke --project=layer-0 --project=layer-1`.

## What belongs in each layer

- **Layer 0 — most essential.** The handful of tests whose failure means the product is broken.
  The marketplace core loop, both halves:
  - `happy-path-partner-to-booking.spec.ts` — partner signs up → configures a beach → consumer
    books & pays (the headline end-to-end).
  - `manage-walkin-reserve.spec.ts` — partner reserves walk-in seats on the manage grid (offline core).
- **Layer 1 — rest of core.** Cancellation/refund, anonymous POS/QR booking, inventory→availability.
- **Layer 2 — main functionality.** F&B ordering, equipment rentals, table reservations w/ deposit.
- **Layer 3 — the rest.** Password reset, account settings, i18n locale switch, branded site pages.

## Current state: SCAFFOLD

Every layer test except the `smoke` test is a **`test.fixme` placeholder** — it reports as
*skipped* (yellow), never red, and documents the intended flow step-by-step. So `npm run e2e`
today = 1 passing smoke test + N skipped placeholders. Implement a placeholder by removing
`test.fixme` and filling in the steps.

## Open questions to resolve before implementing layer 0

These are shared by most real flows and should be decided once, centrally:

1. **Partner authentication.** The partner app is **Google OAuth only**. A real e2e session needs
   either a seeded partner `User` with an auth bypass, or an OAuth test identity. (The consumer
   app also has Credentials + anonymous, which are easier — anonymous POS needs no auth at all.)
2. **Payment.** Use **demo mode** (`NEXT_PUBLIC_DEMO_MODE`) so no real Mollie call is made —
   `pi_demo_…` refs run the same invoice logic. Confirm the env is set for the e2e dev server.
3. **Seed & cleanup.** DB-asserting flows need known starting data (a site + token + active seats)
   and must delete what they create. Add a `support/seed.ts` + `support/db.ts` helper when the
   first DB-dependent test lands (mirror the `/db` skill's queries; reservation↔items live in the
   implicit `_InventoryItemToReservation` table — `"A"`=item, `"B"`=reservation).
4. **Second app server.** Layer 0's happy path drives **both** apps. When implementing it, add the
   partner app (`:3001`) as a second entry in `playwright.config.ts` `webServer` (it accepts an
   array). It's intentionally not booted now so unimplemented runs stay fast.

## Adding a test

1. Drop a `*.spec.ts` in the right `tests/layer-N/` directory.
2. Import `test` / `expect` from the relative `fixtures` (cookie-dismiss + `pageErrors` for free).
3. For surface-driving mechanics use the **`verifier-sunbnb`** skill (ported helpers in `support/`);
   for DB confirmation use the **`/db`** skill.
4. Keep it in the layer that matches its criticality — promote/demote freely as the product evolves.
