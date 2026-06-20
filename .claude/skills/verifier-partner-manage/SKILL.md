---
name: verifier-partner-manage
description: Browser-verify partner manage-page (sites/[id]/manage) GUI flows — walk-in/hold/multiselect reserve, check-in, till, the Guests sheet. The repo's evidence-capture recipe for that surface: run the app, drive the real token-gated grid with Playwright, confirm in the dev DB. Use when verifying any change that reaches the manage page; pair with the `verify` skill.
---

# Verifier: partner manage page

The manage page (`apps/partner/app/sites/[id]/manage`) is a **token-gated, session-less**
DOM grid (ParcelView). It IS drivable by Playwright (seats are real `<div>`s, not a canvas).
This skill is the working recipe so you don't re-derive the cold start. Use it with the
`verify` skill — observe the running app, capture evidence, confirm in the DB.

`handle.mjs` (next to this file) wraps the fiddly parts: `openManage`, `longPress`,
`multiselect`, `bodyText`.

## One-time machine setup

```bash
# Playwright lives in the npx cache, not node_modules. Install the browser once (~90MB):
npx -y playwright@1.61.0 install chromium
```

handle.mjs resolves the npx-cached `playwright/index.js` itself (ESM ignores NODE_PATH, and
it's a CommonJS module → default-import + destructure). Don't `npm i` playwright into the repo.

## 1. Run the app

```bash
cd apps/partner && source .env.local && nohup npm run dev > /tmp/partner-dev.log 2>&1 &
# wait for: "🚀 HTTPS server ready at https://local.sunbnb.app:3001"  (tail /tmp/partner-dev.log)
```

HTTPS is mkcert self-signed → the Playwright context needs `ignoreHTTPSErrors: true` (handle.mjs does this).

## 2. Find a drivable site + token

The URL is `/sites/<siteId>/manage?key=<SecurityToken.id>` — param is **`key`**. You need a
**non-expired** token whose owner owns a site with **≥3 active seats in one parcel** (parcels
group by the first digit of the seat number; some parcels have <3 seats — pick one with ≥3 or
a bigger site). Local dev DB = the `postgres` database in the `sunbnb-postgres` container.

```bash
docker exec sunbnb-postgres psql -U postgres -d postgres -t -c "
SELECT t.id AS token, s.id AS site_id, s.name
FROM \"SecurityToken\" t JOIN \"Site\" s ON s.user_id = t.user_id
WHERE t.expires > now()
  AND (SELECT count(*) FROM \"InventoryItem\" i WHERE i.site_id=s.id AND i.status='active') > 3
LIMIT 6;"
```

Known-good at time of writing: Elafonissi Beach `cm0tkmz4w0001d7nh182fnkz7` + token
`cmnaj142k001p04i31w88fz62` (small, ~11 seats, NNN-1 labels, Parcel 1 has 4). Re-query if stale.

## 3. Drive it

Seats render as DOM divs labelled `NNN-1` (e.g. `009-1`) → `getByText('009-1', {exact:true})`.
Parcel tabs are **text, not buttons** → `getByText('Parcel 2', {exact:true})`, not `getByRole`.
Multiselect = **long-press** one seat (≈450ms; hold 650), then tap the rest. The bulk sheet
then shows **"N selected"** + a Guest-name field + Block / Comp / Reserve / Rent.

```js
import { openManage, multiselect, bodyText } from './.claude/skills/verifier-partner-manage/handle.mjs'
const { browser, page } = await openManage('cm0tkmz4w0001d7nh182fnkz7', 'cmnaj142k001p04i31w88fz62')
await multiselect(page, ['009-1', '010-1', '011-1'])          // → "3 selected" sheet
await page.getByPlaceholder('Guest name').fill('Smith Party') // optional
await page.screenshot({ path: '/tmp/v-selected.png' })        // evidence
await page.getByRole('button', { name: /^reserve$/i }).first().click()  // or /^rent$/i
await page.waitForTimeout(2000)
console.log(await bodyText(page))   // header flips e.g. R0→R3 (reserved) or O0→O3 (occupied)
await browser.close()
```

Run it (handle.mjs needs no special env; chromium uses the default browser cache):

```bash
node /tmp/your-verify-script.mjs
```

All-or-nothing conflict → open **two** contexts (`openManage` twice): A multiselects 3 free
seats but doesn't submit; B grabs one of them (long-press 1 + Reserve); A submits → expect the
red banner **"Couldn't book — one or more selected sunbeds are already taken."** and nothing booked.
(Note: A's grid stays stale — the page polls, no realtime — but the server guard still rejects.)

## 4. Confirm in the DB (the actual proof)

Columns are Prisma `@map`'d **snake_case** (`site_id`, `operational_status`, `payment_amount`,
`guest_name`). The reservation↔items link is the implicit M2N table
**`_InventoryItemToReservation`** with **case-sensitive** columns `"A"` (item id) / `"B"`
(reservation id). `InventoryItem.number` is an **integer** → cast `::text` to aggregate.

```bash
docker exec sunbnb-postgres psql -U postgres -d postgres -c "
SELECT r.id, r.status, r.operational_status, r.payment_amount, count(j.\"A\") items,
       string_agg(ii.number::text, ',' ORDER BY ii.number) seats
FROM \"Reservation\" r
JOIN \"_InventoryItemToReservation\" j ON j.\"B\" = r.id
JOIN \"InventoryItem\" ii ON ii.id = j.\"A\"
WHERE r.site_id='<SITE>' AND r.\"to\" >= now() - interval '1 day'
GROUP BY r.id;"
```

A grouped multiselect reserve/rent must show **ONE** row with N items (not N rows). A grouped
walk-in's `payment_amount` is the **summed** seat price = one till line.

## 5. Clean up (always)

```bash
docker exec sunbnb-postgres psql -U postgres -d postgres -c "DELETE FROM \"Reservation\" WHERE id IN ('<id1>','<id2>');"
lsof -tiTCP:3001 -sTCP:LISTEN | xargs kill 2>/dev/null   # stop the dev server
```

Don't litter the dev DB with test reservations; delete the ones you created by id.

## Pitfalls (each cost time the first run)

- **`import { chromium } from 'playwright'` fails** in a /tmp script — not in node_modules, and
  ESM ignores NODE_PATH. Use `handle.mjs` (resolves the npx cache) or its default-import pattern.
- **`chromium.launch()` errors with no browser** → run the install step above.
- **Parcel tab `getByRole('button', {name:'Parcel 2'})` times out** — tabs are text; use `getByText`.
- **A parcel shows <3 seats** → its first-digit group is small; switch parcels or use a bigger site.
- **Cookie banner** overlaps the bottom bulk sheet → dismiss it first (handle.mjs clicks "OK").
- **`string_agg(number, …)` type error** → `number` is integer; cast `number::text`.
- **Join table `ri.a`/`ri.b` "does not exist"** → columns are uppercase `"A"`/`"B"`, must be quoted.

## Promote this

If browser-verifying the manage page becomes routine, the known-good site/token in §2 and the
seat labels drift — re-query rather than trusting the literals. If other partner GUI surfaces
(orders dashboard, accounting) need the same treatment, generalize the run/handle bits into a
sibling `verifier-partner-*` skill rather than copying.
