# Manual test plan — P1.5 dine-in tabs (track 002)

End-to-end manual verification of the QR order-&-pay-at-the-table loop shipped in
`b55f0b8`…`50043a1` (phases 2–5). Two apps, ideally two devices. Demo payment runs fully
locally; the **Mollie leg needs the test environment** (marked ⏳ below).

**How to use:** run suites in order — later suites reuse earlier state. `[ ]` per step;
anything surprising goes in the *Findings* section at the bottom, even if it "works".

## 0. Prerequisites

- [ ] Both apps running locally:
  `cd apps/partner && source .env.local && npm run dev` → https://local.sunbnb.app:3001
  `cd apps/user && source .env.local && npm run dev` → https://local.sunbnb.app:3002
- [ ] `NEXT_PUBLIC_DEMO_MODE=true` in `apps/user/.env.local` (demo pay path).
- [ ] The `restaurants` feature flag resolves enabled in dev (env override
  `FLAG_RESTAURANTS`, DB row, or dev default — see `packages/data/src/flags.ts`).
- [ ] **Test data** (find or create via partner UI; verify with `/db` local):
  - A **Site** with `appSalesEnabled = true` and ≥3 active **Products** (F&B items with prices).
  - A **Restaurant** with `siteId` set to that site (the chiringuito case) and ≥2 **active
    Tables**.
- [ ] A second device (phone) or second browser profile for the companion-phone suites.
  A phone on the same Wi-Fi can open `https://local.sunbnb.app:3002` only with hosts/cert
  setup — otherwise simulate "phone 2" with an incognito window.

> Out of scope here: ES/FI copy review (separate promote gate), standalone (no-site)
> restaurants (correctly excluded from v1), tips / split-the-bill / per-round pay (not in v1).

## A. QR cards (partner)

1. [ ] Partner app → the restaurant → **Tables** tab. A **Dine-in QR** button is present.
2. [ ] Click it → a PDF downloads with **one card per active table**; each QR encodes
   `<consumer-app>/sites/<siteId>/dine/<tableId>`.
3. [ ] Inactive tables get **no** card.
4. [ ] 🔍 A restaurant **without** `siteId` (standalone): the button is **hidden**.

## B. Scan & browse (consumer, phone 1)

1. [ ] Open a table's dine URL (scan the printed QR, or paste it). Page shows restaurant
   name + a table chip + the site's product menu grouped by category.
2. [ ] **No tab exists yet** — no "Your tab" section, and (via `/db`) no `TableTab` row for
   the table. *Scanning alone must not write anything.*
3. [ ] 🔍 A wrong/invalid `tableId` in the URL, and a table belonging to a **different**
   site → not-found, no menu leak.
4. [ ] 🔍 Toggle the site's `appSalesEnabled` off briefly → dine page refuses; toggle back.

## C. First order opens the tab; kitchen sees rounds

1. [ ] Phone 1: add 2–3 items to the cart → review sheet shows correct items/prices
   (DB prices, not client) → place the order.
2. [ ] "Your tab" appears with round 1 and a running total. (`/db`: exactly **one**
   `TableTab`, status `open`, `openTableId = tableId`.)
3. [ ] Partner **orders dashboard**: the round arrives as an incoming order with a
   **violet table chip** naming the table.
4. [ ] Kitchen lifecycle works as usual on the round (accept → preparing → ready →
   delivered) — the tab stays `open`, un-paid.
5. [ ] Place a **second round** from phone 1 → dashboard gets a second order, same table
   chip; tab shows both rounds, total = sum of both.

## D. Second phone joins the same tab

1. [ ] Phone 2: open the **same** table URL → sees the same tab (both rounds, same total).
2. [ ] Phone 2 places its own round → appears on phone 1's tab (within the ~30s poll).
3. [ ] `/db`: **still one** `TableTab` — no duplicate tab from concurrent first orders.

## E. Close & pay — demo path

1. [ ] Phone 1: **Close & pay** (visible since tab is open and total > 0) → confirm sheet
   shows *orders total*, *service fee* (if configured), and *payable total* = sum.
2. [ ] Confirm (demo) → paid card with green check and the paid amount.
3. [ ] Phone 2 (companion): within ~30s its view flips to **paid** on its own — no refresh.
4. [ ] Ordering is now closed on both phones (no cart; next guest = new scan → new tab).
5. [ ] `/db`: tab `paid`, `openTableId` **null**; **two invoices** exist for the tab —
   one gross **PARTNER**, one **PLATFORM** commission (they do not sum to the consumer total).
6. [ ] Kitchen states of already-delivered rounds are **unchanged** by the payment.
7. [ ] 🔍 Immediately re-opening the dine URL after payment starts a **fresh** empty
   menu/no-tab state; a new order opens a **new** tab.

## F. ⏳ Close & pay — Mollie (test environment only)

1. [ ] On test.sunbnb.app with a Mollie-connected site: Close & pay → Mollie → redirects to
   Mollie checkout; pay with a test method → returns to the dine URL → *verifying* spinner →
   paid card.
2. [ ] 🔍 **Abandon/fail** the Mollie payment instead → return shows "payment didn't
   complete" banner; tab is back to `open`; ordering resumes; a later retry succeeds.
3. [ ] 🔍 While a Mollie payment is mid-flight (`pending_payment`): phone 2 sees ordering
   **disabled** (banner), and staff **settle-cash is rejected** for that tab.

## G. Staff: settle as cash

*(Fresh tab: order a round from phone 1 first.)*

1. [ ] Orders dashboard → open-tabs panel lists the tab with amount due =
   **orders total only** (no service fee on cash).
2. [ ] Settle cash (with its confirm step) → tab closes; consumer phones show paid/closed.
3. [ ] `/db`: tab `settled_cash`, `openTableId` null; **PARTNER receipt only — no PLATFORM
   commission invoice, no paymentRef.**

## H. Staff: discard (walk-out)

*(Fresh tab again: one round.)*

1. [ ] Open-tabs panel → discard (confirm step) → tab closed, rounds **voided**.
2. [ ] `/db`: tab `discarded`; **no invoices**; voided rounds excluded from any total.
3. [ ] Consumer phone ends in the closed state; a new order at the table opens a new tab.

## I. Accounting & analytics (partner)

1. [ ] Site **accounting** page, current month: a **"Dine-in tabs"** card lists the paid
   (online) and cash-settled tabs with cash/online badge and net/VAT/gross that match the
   invoice amounts. The discarded tab is absent.
2. [ ] 🔍 With a **still-open** unpaid tab carrying rounds: revenue/analytics do **not**
   include those rounds (tab-order paid-ness rule) — they appear only after pay/settle.

## Findings

| # | Suite/step | What happened | Severity (blocker / bug / polish / note) |
|---|---|---|---|
| 1 | A (2026-07-23) | **PASS.** QR PDF: one card per active table, inactive excluded, standalone restaurant hides the button. | — |
| 2 | A.2 | Floor-plan tiles show `label ?? capacity` while QR cards say `Table {number}` — unlabeled tables read "4" on the plan vs "Table 2" on the card; operator can't match them. Candidate one-liner: tile fallback → `label ?? String(number)`. | polish |
| 3 | A.2 | `CONSUMER_APP_URL` unset locally → QR cards encode the `https://sunbnb.app` fallback (prod). Fine in prod; for local scans set it to `https://local.sunbnb.app:3002`. | note |
| 4 | B (2026-07-23) | **PASS.** Menu + table chip render; invalid & cross-site table ids refused; `appSalesEnabled` gate works; scan writes nothing. | — |
| 5 | F.2 (hit early, 2026-07-23) | Abandoned a real Mollie checkout locally → tab stuck `pending_payment`: webhooks can't reach localhost and the poll only reverts on failed/canceled/expired (abandoned = "open" at Mollie ~15 min). Recovered by mimicking the route's `revertClaim` in SQL. Local-env limitation, works as designed — F stays test-env-only. | note |
| 6 | C.1–C.4 (2026-07-23) | **PASS** — rounds reach the kitchen dashboard with the violet table chip; kitchen lifecycle runs normally on tab rounds; tab stays open/unpaid throughout. C.5 + suites D/E/G/H/I **paused here** (founder switching tasks); resume with D using the second-window URL in suite D. Adaptive polling (5s visible / pause hidden / refetch-on-focus) was added mid-run — D.2's ~5s propagation doubles as its live verification. | — |
| 7 | F.2 → gap | **`/api/reconcile` has no tab coverage.** If the webhook is missed AND the guest closes the dine page (its poll is the only other resolver), a `pending_payment` tab has no automated recovery — staff settle/discard are correctly rejected while pending. Fix candidate for phase 6: reconcile re-verifies pending tabs via `getPaymentStatus` (paid → `processConfirmedTabPayment`, failed/expired → revert to open). | **bug (prod ops)** |
