---
name: verifier-sunbnb
description: Browser-verify Sunbnb app GUI flows (partner :3001 / user :3002 / admin :3003) — the repo's evidence-capture recipe for the bundled `verify` skill. Run an app, drive the real UI with Playwright, confirm in the DB via /db. Use when verifying any change that reaches a browser surface; the per-surface mechanics (e.g. the partner manage grid) are sections below — extend as you verify new surfaces.
---

# Verifier: Sunbnb apps

The bundled **`verify`** skill is the general framework (run → drive the surface → capture
evidence). **This** skill is the repo-specific handle it tells you to capture: how to run
*these* apps, get a Playwright handle past *our* mkcert HTTPS, and confirm in *our* DB. Pair
the two — run the app, observe, screenshot, confirm.

`handle.mjs` (next to this file) wraps the fiddly parts: `openApp`, `openManage`, `longPress`,
`multiselect`, `bodyText`, `APPS`.

> Most of this skill is **app-agnostic** (setup, run, handle, DB, cleanup). The per-surface
> driving mechanics live under **Surface recipes** — today only the partner manage grid is
> filled in. When you browser-verify a new surface (user booking flow, orders dashboard…),
> add a section there rather than starting from scratch.

## One-time machine setup

```bash
npx -y playwright@1.61.0 install chromium   # ~90MB headless shell → ~/Library/Caches/ms-playwright
```

`handle.mjs` resolves the npx-cached `playwright/index.js` itself (ESM ignores NODE_PATH; it's
CommonJS → default-import + destructure). Don't `npm i` playwright into the repo.

## 1. Run the target app

```bash
cd apps/<app> && source .env.local && nohup npm run dev > /tmp/<app>-dev.log 2>&1 &
# partner → https://local.sunbnb.app:3001   user → :3002   admin → :3003   (HTTPS via mkcert)
# wait for: "🚀 HTTPS server ready at https://local.sunbnb.app:<port>"
```

## 2. Get a Playwright handle

`openApp(app, path)` works for any app; it launches an `ignoreHTTPSErrors` context (mkcert) and
dismisses the cookie banner. Convenience wrappers exist for token-gated surfaces.

```js
import { openApp, openManage, bodyText } from './.claude/skills/verifier-sunbnb/handle.mjs'

// generic — any app, any route:
const { browser, page } = await openApp('user', '/sites/<id>')
// …drive…
console.log(await bodyText(page)); await browser.close()
```

Run a verify script with plain `node /tmp/your-script.mjs` (handle.mjs needs no special env;
chromium uses the default browser cache).

## 3. Confirm in the DB (the actual proof)

Use the **`/db`** skill (`.claude/commands/db.md`) — schema-aware, env-tiered, read-only — to
inspect rows after driving the UI. For a local browser-verify you're querying the **local** dev
DB (the `postgres` database in the `sunbnb-postgres` container). Verification-specific gotcha
`/db` may not volunteer: the reservation↔items link is the implicit M2N table
**`_InventoryItemToReservation`**, columns **`"A"`** (item id) / **`"B"`** (reservation id),
case-sensitive; `InventoryItem.number` is an integer (cast `::text` to aggregate). Prisma
columns are `@map`'d snake_case (`site_id`, `operational_status`, `payment_amount`).

## 4. Clean up (always)

```bash
# delete any rows you created, by id, then stop the server:
lsof -tiTCP:<port> -sTCP:LISTEN | xargs kill 2>/dev/null
```

Don't litter the dev DB with test data; delete what you created.

## Pitfalls (app-agnostic — each cost time once)

- **`import { chromium } from 'playwright'` fails** in a /tmp script — not in node_modules, ESM
  ignores NODE_PATH. Use `handle.mjs` (resolves the npx cache) or its default-import pattern.
- **`chromium.launch()` errors with no browser** → run the install step.
- **Cookie banner** overlaps bottom UI → dismiss first (`openApp` does, unless `dismissCookie:false`).
- **Self-signed HTTPS** → context needs `ignoreHTTPSErrors` (`openApp` sets it).

---

# Surface recipes

## Partner manage page — `sites/[id]/manage`

**Token-gated, session-less** DOM grid (ParcelView; seats are real `<div>`s, drivable). URL is
`/sites/<siteId>/manage?key=<SecurityToken.id>` — param is **`key`**.

**Find a site + token** (via `/db`, or directly): a non-expired token whose owner owns a site
with **≥3 active seats in one parcel** (parcels group by the first digit of the seat number;
some parcels have <3 seats — pick one with ≥3 or a bigger site).

```sql
SELECT t.id AS token, s.id AS site_id, s.name
FROM "SecurityToken" t JOIN "Site" s ON s.user_id = t.user_id
WHERE t.expires > now()
  AND (SELECT count(*) FROM "InventoryItem" i WHERE i.site_id=s.id AND i.status='active') > 3
LIMIT 6;
```

**Drive it.** Seats render as `NNN-1` labels → `getByText('009-1',{exact:true})`. Parcel tabs are
**text, not buttons** → `getByText('Parcel 2',{exact:true})`. Multiselect = **long-press** one
seat (≈450ms; hold 650), then tap the rest → bulk sheet shows **"N selected"** + Guest-name field
+ Block / Comp / Reserve / Rent.

```js
import { openManage, multiselect, bodyText } from './.claude/skills/verifier-sunbnb/handle.mjs'
const { browser, page } = await openManage('<siteId>', '<token>')
await multiselect(page, ['009-1','010-1','011-1'])           // → "3 selected"
await page.getByPlaceholder('Guest name').fill('Smith Party') // optional
await page.screenshot({ path: '/tmp/v-selected.png' })
await page.getByRole('button', { name: /^reserve$/i }).first().click()  // or /^rent$/i
await page.waitForTimeout(2000); console.log(await bodyText(page))      // header flips R0→R3 / O0→O3
await browser.close()
```

Concurrency / conflict probe → open **two** contexts: A multiselects free seats but doesn't
submit; B grabs one (long-press 1 + Reserve); A submits → expect the red banner *"Couldn't book
— one or more selected sunbeds are already taken."* and nothing booked. (A's grid stays stale —
the page polls, no realtime — but the server guard still rejects.)

**Manage-specific pitfalls:** parcel tab `getByRole('button',…)` times out (use `getByText`); a
parcel with <3 seats (switch parcel / bigger site).

## User app — `apps/user` (:3002)

_Not yet filled in._ Use `openApp('user', '<path>')` for the handle; add the booking/POS driving
mechanics here the first time you browser-verify a user-app change.
