# E2E layer (`@repo/e2e`)

Durable, browser-driven end-to-end suite for the Sunbnb apps, on [Playwright](https://playwright.dev).
This is the standing counterpart to the **`verifier-sunbnb`** skill (`.claude/skills/verifier-sunbnb/`),
which is the *ad-hoc* agent recipe for the same thing — same mechanics (mkcert HTTPS, cookie
dismiss, manage-grid driving), but here they live in config + fixtures and run under a real test
runner with assertions, retries, traces, and an HTML report.

## ⚠️ Excluded from automated runs — by design

This layer is **manual / on-demand only**. It is **not** part of `npm run test` /
`npm run test:integration`, **not** in CI, the `.githooks/pre-push` hook, or the
`promote-to-test.sh` / `deploy-to-production.sh` scripts.

The mechanism: `turbo test` and `turbo run test:integration` only execute tasks **named** `test`
/ `test:integration` in a workspace's `package.json`. This package defines **neither** — only an
`e2e` script — and `turbo.json` has **no** `e2e` task. So turbo can never pick it up. The only
way to run it is the explicit `npm run e2e`.

**Do not "helpfully" wire this into CI or the deploy scripts** without a deliberate decision — the
exclusion is the point (these tests need a running app + Docker Postgres and are slower/heavier
than the unit/integration spine).

## Test layers

The suite is graded into 4 layers by criticality (layer 0 = most essential) plus a boot smoke
precondition — see **[LAYERS.md](./LAYERS.md)** for the taxonomy and what belongs where. Today
everything past the smoke test is a `test.fixme` scaffold placeholder (skipped, documents the flow).

## Run it

```bash
# from the repo root
npm run e2e                 # run the whole suite (boots/reuses the user app on :3002)

# or from this directory
cd e2e
npm run e2e:smoke           # boot smoke only (the passing one today)
npm run e2e:critical        # critical gate: smoke + layer 0
npm run e2e:l0              # layer 0 — most essential critical core
npm run e2e:l1 / :l2 / :l3 # the other layers
npm run e2e:headed          # watch it drive a real browser
npm run e2e:ui              # Playwright UI mode (pick/inspect tests)
npm run e2e:report          # open the last HTML report
```

### Prerequisites

- **Chromium browser binary** — install once per machine (same build the verifier skill uses):
  ```bash
  npx -y playwright@1.61.0 install chromium
  ```
- **Docker Postgres** up (the user app needs the DB) and `apps/user/.env.local` present — the
  Playwright `webServer` boots the user app with `source .env.local && npm run dev`, or **reuses**
  a dev server you already have running on :3002.

## Layout

```
playwright.config.ts   # runner config: baseURL, mkcert ignoreHTTPSErrors, webServer, reporters
fixtures.ts            # custom `test`/`expect` — auto cookie-dismiss + uncaught-error collector
support/manage.ts      # partner manage-grid helpers (longPress / multiselect / manageUrl), staged
tests/
  smoke.spec.ts        # the one smoke test: user app boots and renders
```

Specs import `test` / `expect` from `../fixtures`, **not** from `@playwright/test` directly, so
every test gets the cookie-banner dismiss and the `pageErrors` collector for free.

## Growing the suite

Next tests step up from "does it boot" to real flows. The driving mechanics for each surface come
from the **`verifier-sunbnb`** skill; port them into `support/` as you go (the manage-grid helpers
already are). DB-asserting flows (e.g. manage-grid reserve → confirm the row) use the **`/db`**
skill's query approach — the implicit reservation↔items table is `_InventoryItemToReservation`
(`"A"` = item id, `"B"` = reservation id). Add a seed/fixtures helper when the first
DB-dependent flow lands.
