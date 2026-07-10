---
id: 015-cash-sale-receipts
title: Cash-sale receipts (invoice every income)
status: active
created: 2026-07-10
updated: 2026-07-10
worktree: null
---

## Goal

**Generate a PARTNER receipt (invoice) for every cash sale**, so the partner accounting tab can
export legally-complete accounting data. Today invoices are created ONLY by `processConfirmed*` on
**online (Mollie/demo) payment confirmation**; `paid-in-cash` walk-ins record `paymentAmount` + a
`TillEntry` but **never an invoice** (confirmed: 105 `paid-in-cash` reservations → 0 PARTNER
invoices in local DB). An invoice-based accounting export would therefore omit the bulk of income
(June: €698 of €788 was cash). This track closes that gap.

**Decisions (user, 2026-07-10):**
- **Receipt only, NO commission on cash.** Cash sales generate the PARTNER receipt (gross sale +
  VAT from `site.vat`), NOT the PLATFORM commission invoice. (Online keeps both.) Cash-commission
  collection is out of scope — cash is treated commission-free for now.
- **Backfill** existing cash sales (not cutover), and prepare a backfill runnable against
  **local + test + production**.

**Non-goals (this track):** cash-commission billing/settlement; credit-note/void on cash refunds
(flagged as follow-on — an unreserved/refunded cash sale needs a credit note the model doesn't do
yet); the accounting-export UI itself is the FINAL phase (P5), unblocked once cash is invoiced.

## Resume here

- **ALL 5 PHASES BUILT & GREEN (P1–P5). Backfill APPLIED to test+prod by the user (38 prod receipts).**
  **The only thing left is a user OPS action: commit + deploy P1–P5, then re-run
  `npm run backfill:cash:production` (idempotent) to sweep cash sales made between the first backfill
  and the deploy** (the live prod app won't generate receipts for new cash sales until the code ships).
  Everything is uncommitted. Deferred (separate follow-on): cash **refund → credit note** (an
  unreserved/refunded cash sale should void/credit its receipt — the fiscal `refunds` figure is
  informational until then); numbering-chronology imperfection for backfilled invoices (accepted).
- ~~P3 timing fork~~ RESOLVED: issue at settle. ~~P1~~ done.
- **P3 timing fork (needs a decision before wiring):** *when* to issue the cash receipt.
  - **At creation (point of sale)** — simplest, but a cash walk-in later **collected online via QR**
    (`collectReservationPayment` → status `complete` → `processConfirmedReservation`) would hit the
    `invoices.length > 0` idempotency guard and **skip the online PARTNER+PLATFORM invoices** — so the
    platform loses commission and the sale is mis-recorded as a cash receipt. Broken unless the collect
    flow voids/reissues.
  - **At settle / cash-confirmed (recommended)** — issue the receipt when the cash is actually taken
    (the `settleReservation`/till "Settle" event; track 013), NOT at creation. Only truly-cash sales
    get the cash receipt; a QR-collected one flows through the normal online path (PARTNER+PLATFORM).
    Avoids the double-invoice/commission-loss entirely. Aligns with the existing "walk-ins start
    unsettled" refactor.
  - Cash rentals/orders have no collect-online transition, so those can issue at creation regardless.
- ~~**Next action: P1**~~ (done) — the core cash-receipt path in `@repo/data` (`packages/data/src/payment.ts`).
  Add a PARTNER-only receipt path (reuse the PARTNER-invoice block of `processConfirmedReservation`
  — VAT reverse-calc from `site.vat`, `nextInvoiceNumber`/`getLastHash` numbering + hash chain,
  per-item product lines, idempotency; SKIP the PLATFORM commission block). Preferred shape: extend
  `processConfirmedReservation(reservationId, opts?: { skipCommission?: boolean; invoicedAt?: Date })`
  — backward-compatible default (both invoices, `invoicedAt = now`); `skipCommission` → PARTNER only;
  `invoicedAt` override drives the invoice-number YEAR (for backfilling historical sales). Integration-test.
- **Context:** the PARTNER block is `payment.ts:526–569`; the PLATFORM block follows it. Idempotency
  guard (`status === COMPLETE || invoices.length > 0`) already lets a `paid-in-cash` reservation
  through (it's not COMPLETE) and blocks re-invoicing (invoices > 0). Cash path must NOT mutate
  reservation status (stays `paid-in-cash`).
- **Known risk — backfill numbering chronology:** invoice numbers are gapless per issuer/year and
  immutable. Backfilling June sales *now* appends numbers after existing July online invoices →
  numbers won't be perfectly date-monotonic for the historical set. Mitigation: backfill in
  `createdAt` order, `invoicedAt = sale date`, number-year = sale year. Accept the one-time
  imperfection (document); never renumber existing invoices.

## Roadmap

- ✅ **P1 — Core cash receipt (reservations). DONE 2026-07-10.** `processConfirmedReservation(id, opts?:
  { skipCommission?, invoicedAt? })` — default path unchanged (PARTNER+PLATFORM, status→COMPLETE);
  `skipCommission` → PARTNER-only receipt, status stays `paid-in-cash`; `invoicedAt` override threads
  its year into `nextInvoiceNumber(tx, type, year=…)` for backfill. Idempotent (reused guard).
  data 247u + 194i (5 new cash-path tests), tsc/lint clean, existing `payment.integration.test.ts`
  green (backward-compat proven). Callers NOT wired yet (P3).
- ✅ **P2 — Cash rentals + cash orders. DONE 2026-07-10.** `processConfirmedOrder(id, opts?)` gained
  the same `{ skipCommission, invoicedAt }` (per-item VAT preserved). Rentals: added a NEW by-id
  `processCashRentalBooking(rentalBookingId, opts?)` (the online `processConfirmedRentalBooking` stays
  paymentRef-keyed). **Gotcha fixed:** the Invoice model has **no `rentalBookingId` FK** (that field is
  on `TillEntry`) — rental invoices link via `paymentRef`. Cash rentals (null paymentRef) use a
  deterministic `cash-rental-${bookingId}` ref for both linkage + idempotency. data 206i green
  (46 in payment.integration incl. cash order + cash rental paths), tsc clean.
- ✅ **P3 — Wiring at SETTLE. DONE 2026-07-10.** `issueCashReservationReceipt` (non-blocking
  try/catch → `processConfirmedReservation(id,{skipCommission:true})`) called after each reservation
  cash `recordSettlement` — 6 sites (`reserveItem`, `reserveItems`, 3× `convertHoldToWalkIn` split
  paths, `settleReservation`). `createWalkInRental` → `processCashRentalBooking(bookingId)`. **Guard =
  `recordCashSettlement` (NOT `paymentType`)** so the Card/QR path (which passes `paymentType='cash'`
  but `recordCashSettlement=false`, later invoiced via Mollie collect) isn't double-invoiced. No
  partner-side cash-ORDER flow exists (orders are consumer-app only). Non-blocking: a receipt failure
  logs, never rolls back the sale (backfill is the net). partner 1724u green (+11), tsc/lint clean.
- ✅ **P4 — Backfill script + skipEmail fix. DONE 2026-07-10.** `packages/data/scripts/backfill-cash-
  receipts.ts` — idempotent, chronological (createdAt ASC), `--dry-run`; 6 npm scripts
  (`backfill:cash:{local,test,production}` + `:dry`, test/prod via `with-db-url.sh`). Backfills
  reservations (`paid-in-cash`, amount>0, not comp/blocked/refunded, no PARTNER invoice), cash rentals
  (deterministic `cash-rental-<id>` ref), cash orders (0 expected). Back-dates `invoicedAt=createdAt`.
  **Ran on LOCAL: 37 reservations + 11 rentals = 48 receipts, idempotency proven (2nd dry-run = 0).**
  **Footgun fixed:** `processConfirmedReservation` fires a customer confirmation email — added
  `skipEmail` opt (backfill AND live P3 wiring pass `skipEmail:true`) so backfilling historical sales
  doesn't email customers "confirmed" weeks later, and live cash walk-ins don't get surprise emails
  (matches prior no-email-for-cash behaviour; online path unchanged). data 247u + tests green,
  partner 1724u green. **USER runs test+prod backfill** (commands in Resume-here / below).
- ✅ **P5 — Accounting export UI. DONE 2026-07-10.** `@repo/data/fiscal` `getMonthlyFiscalReport`
  (invoice-based, per-site via reservation/order siteId + rental paymentRef-set join; PARTNER sales +
  PLATFORM commission + processingFees + VAT-by-rate from lines + refunds) → partner action
  `getMonthlyFiscalReport(siteId,year,month)`. UI: **Accounting export** card (payments · gross · net ·
  VAT · VAT-by-rate table · platform commission + reverse-charge chip · processing fees · refunds w/
  credit-note caveat) + client-side **CSV invoice-register download** (10 cols) — **replaced the old
  browsable orders/reservations detail tables** (removed `getPaidItemsByMonth`/`paidItems`/expanded
  state + 8 orphan i18n keys). New partner mock `@repo/data/fiscal` + vitest alias + mock-contract
  SUBMODULE_SPECS + coverage-contract allowlist. data 247u+219i (13 new fiscal), partner 1725u green,
  tsc/lint clean, en/es/fi 75-key parity (EN verified). Same PARTNER-only path for `processConfirmedRentalBooking`
  + `processConfirmedOrder` (identify cash order flows). (data-dev)
- ☐ **P3 — Point-of-sale wiring.** Call the receipt path from the cash walk-in flows in
  `manage/actions.ts` (`reserveItem`/walk-in cash, `createWalkInRental`, cash orders) at creation.
  Tests + gated-action/mock impact. (partner-dev)
- ☐ **P4 — Backfill script.** Env-tiered (`local`/`test`/`production` via `scripts/with-db-url.sh`),
  idempotent, dry-run-first, chronological. User runs test+prod (per `project_prod_deploy` — Claude
  doesn't run prod ops). (data-dev)
- ☐ **P5 — Accounting export UI.** The original goal: per-site monthly fiscal summary (# payments,
  gross, net, total VAT, **VAT-by-rate**, platform commission, processing fees, refunds) + a CSV
  invoice-register download for the accountant. Invoice-based (now complete with cash). (partner-dev)

## Log

- **2026-07-10** — **Backfill APPLIED to TEST + PRODUCTION by the user.** Prod dry-run → 38 cash
  reservation candidates (0 rentals, 0 orders); live run created **38 receipts, 0 errors**; confirming
  dry-run showed **0 remaining** (idempotent). ⚠️ **DEPLOY GAP:** the backfill ran local code vs the
  prod DB, but P1–P4 app code is NOT deployed — the live prod app won't generate receipts for NEW cash
  sales until committed+deployed. Mitigation: after deploy, re-run `backfill:cash:production` (idempotent)
  to sweep the gap. **Commit + deploy P1–P4 (+P5) is now the priority.**

- **2026-07-10** — Track created. Root-caused the accounting-export blocker: cash sales generate no
  invoices (only `processConfirmed*` on online payment does). User chose A (generate cash receipts)
  over a takings/reverse-VAT report; receipt-only (no cash commission); backfill incl. test+prod.
  Read the invoice core (`processConfirmedReservation`) — the PARTNER block is directly reusable;
  plan is to add `skipCommission`/`invoicedAt` opts rather than duplicate. P1 starting.

## Open decisions

- **Payment-method marker on the invoice?** The export wants a cash/card/online column. Can be
  INFERRED (cash invoice ⇒ linked reservation `paid-in-cash` / `paymentRef` null) — prefer inference,
  no schema change. Revisit only if inference proves unreliable.
- **Cash refund → credit note (P-later).** Out of scope now; an unreserved/refunded cash sale should
  void/credit its receipt. Design when the refund flow is revisited.

## Links

- Blocks: the accounting-export feature (P5) — the reason this track exists.
- Rules in force: `.claude/rules/payments.md` (agent model, idempotency, DB prices, reverse-VAT),
  `.claude/rules/architecture.md` (payment-core = architecture pass), `.claude/rules/migrations.md`
  (if any schema field is added). Sibling: [[track:006-alonso-staff-ui]] (the accounting-tab work
  this unblocks).
