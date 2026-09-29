---
id: 026-verifactu
title: Veri*factu — Spanish fiscal compliance for receipts and invoices
status: active
created: 2026-09-29
updated: 2026-09-29
worktree: null
---

## Goal

Make the receipts and invoices Sunbnb issues on behalf of **Spanish partners** genuinely
compliant with **RD 1007/2023** (+ Orden HAC/1177/2024): chained per issuer, QR-bearing,
and transmitted to AEAT as they are issued (**Veri\*factu remisión**, not the
locally-signed variant).

**Why it matters, and why it is urgent.** `apps/partner/app/legal/verifactu/page.tsx` is
LIVE, linked from the partner landing footer, dated *Effective: 7 March 2026*. It tells
Spanish partners that Sunbnb "generates Veri\*factu-compliant receipts", that "**every
receipt includes a QR code formatted per AEAT specifications**", and that receipts carry
the issuer NIF/CIF. None of that was true when this track opened. The founder chose to
close the gap by shipping rather than by softening the page, so **every phase below names
which claim it makes true**.

**The second reason.** Half of what compliance requires is not Spanish at all — it is
ordinary correct invoicing that was wrong in every market. One global
`PARTNER-YYYY-NNNNN` counter and one hash chain were shared by three separate legal
entities, so each one's "correlative" numbering was mostly holes belonging to somebody
else. That is EU invoicing law, not RD 1007/2023; Veri\*factu merely made it visible.

**Scope.** Series, chaining, tax-id validation and receipt correctness are **universal** —
every issuer, every country. Record generation, the QR and transmission are **Spain only**,
behind a thin regime resolver that is deliberately not a multi-regime framework
(`packages/data/src/tax/regime.ts` says so in its header, and says not to generalise it on
one example).

**Out of scope:** TicketBAI (Basque/Navarra). The resolver NAMES those issuers
`ES_FORAL_UNSUPPORTED` so they are never filed with the wrong authority, and nothing
implements them. No partner is in a foral territory today.

## Resume here

**Next action — the `VerifactuRecord` / `VerifactuChain` schema, and writing a record inside
the invoice transaction.** Everything a record is BUILT from exists and is tested; nothing
produces one yet.

Recommended shape is in the plan and in phase 5 below: one table, not columns on `Invoice`,
because it is 1:N (an alta, a later anulación, a rectificativa's own alta), because
submission state is churny while `Invoice` must stay immutable, and because the *registro*
stream is what an inspector asks for. Store `huellaInput` verbatim — it is the only way to
debug a rejection.

**Context needed:**
- `packages/data/src/tax/es-verifactu/huella.ts` — canonical string + serialization helpers.
  **Read its header before trusting the field order** (see Open decisions D1).
- `packages/data/src/tax/es-verifactu/tipo-factura.ts` — `classifyTipoFactura`, `buildDesglose`.
- `packages/data/src/tax/regime.ts` — `resolveTaxRegime`, `regimeRequiresRecords`.
- `packages/data/src/invoice-series.ts` — the per-issuer allocator and `lockInvoiceSeries`;
  a record is written in the SAME transaction as its invoice, under the same lock.
- `packages/data/src/payment.ts` — seven writers, each already taking the issuer lock before
  its idempotency re-check.

**Blocked by (does not block the schema, DOES block phase 7):** asesor answer to D2 —
whether Sunbnb may submit on partners' behalf under an *apoderamiento*. It decides whether
transmission needs ONE platform certificate in an env var or a per-partner encrypted
keystore, and the record schema is where that assumption first gets baked in.

**Not yet done and easy to forget:** seven commits are unpushed; the production
clean-slate deletion (D3) is deferred to cutover.

## Roadmap

- ✅ **P1 — Fiscal register correctness** (`a24c2d7`). Independent of compliance: these were
  wrong numbers an accountant was already using. `refunds` was derived from source-record
  status, and cash refunds never set any of those — production had ZERO records with
  `refundedAt` and 29 credit notes, so the figure was structurally always €0.00 while
  €576.00 had been credited. Now credit-note-derived, with `unInvoicedRefunds` as a
  watchdog. Also added the missing tab/deposit branches to site scoping, and the two
  indexes `Invoice` never had. *Makes true: "exportable records".*
- ✅ **P2 — Universal per-issuer series + chain** (`04b225b`). Numbers render
  `AB-F-2026-00001`; `seriesKey` is `PartnerAccount.userId`, never the mutable NIF.
  `computeInvoiceHash` exported and `verifyInvoiceChain` added — the integrity claim was
  previously uncheckable. **Exposed a duplicate-invoice hole in all seven writers**: the
  shared counter had been an accidental platform-wide mutex made of a unique-constraint
  exception, so serialisation is now deliberate (`lockInvoiceSeries` before each
  idempotency check). *Makes true: "cryptographic chaining", honestly.*
- ✅ **P3 — Issuer identity** (`e75711c`, `05b06dd`). `vat-id.ts` (ES NIF/NIE/CIF, FI
  Y-tunnus, EU shapes), the regime resolver, `PartnerAccount.vatIdStatus`/`taxRegion`/
  `isTestAccount`. Partner ids are recorded and never block a sale; the PLATFORM's own id
  IS rejected; an unconfigured platform skips the commission invoice and still writes the
  receipt. Closed `PLATFORM-2026-00001` — a real invoice naming "Platform Operator" with a
  NULL tax id, the `getBusinessEntity` DEFAULTS placeholder, inside the hash chain that
  certified it. *Makes true: "issuer NIF/CIF on every receipt".*
- ✅ **P4 — Unify receipts, give dine-in tabs one** (`427e9ac`). A guest who paid for a meal
  at a table could obtain no document at all — the primary obligation unmet, which is why
  it ranks above the QR. One `ReceiptModel` for four surfaces; the email had drifted to
  showing a VAT rate where the others showed an amount. `platformSection` DELETED rather
  than populated (the agent model means it is a number the guest neither paid nor is party
  to). Credit notes excluded from being rendered as the receipt for a sale.
- ▶ **P5 — ES record generation** (`737a28d`, `77df2fa` — *partial*). Done: the huella with
  a verified golden vector, `TipoFactura` classification, `buildDesglose` refusing null and
  illegal rates, and the credit-note rate fix (`issueCashCreditNote` derived
  `totalTax/totalCharge*100`, producing stored rates of 20.98/21.01/21.03 that AEAT rejects
  — all 29 production credit notes are unfilable as they stand). **Remaining: the
  `VerifactuRecord`/`VerifactuChain` schema and writing a record in the invoice transaction,
  gated on the regime.** `fechaExpedicion` in `Site.timeZone`.
- ☐ **P6 — QR and the VERI\*FACTU legend.** Key property: **the QR payload does not contain
  the CSV** (issuer NIF + number + date + total only), so receipt rendering never waits on
  AEAT — which is what makes a cron-swept transport lawful. Say that loudly so nobody builds
  a blocking submit. Hosted PNG endpoint rather than a data URI: Gmail strips inline
  data-URI images, and the email receipt is the copy a guest keeps. `qrcode` must be added
  to `apps/user`. *Makes true: "every receipt includes a QR code" — the most conspicuous
  false claim on the live page.*
- ☐ **P7 — Transmission.** SOAP over mTLS with a stub for CI (`packages/data/src/viva/` is
  the mode-switch pattern). DB-state-as-queue sweep modelled on `/api/reconcile` but WITH
  the attempt counter, backoff and `blocked` terminal state it lacks. **Wire the cron in
  `vercel.json` in the same commit** — `/api/reconcile` is the standing proof that a route
  shipped without its trigger stays dark forever. **Records within a chain must arrive in
  chain order, so the sweep stops at the first failure for that NIF**; head-of-line blocking
  is correct here, not a bug, and a future maintainer will otherwise "fix" it into a
  compliance breach. *Makes true: "transmitted to AEAT".*
- ☐ **P8 — Anulación and rectificativa completeness.** **A credit note is an `Alta` of a
  rectificativa, not an `Anulación`**; anulación is for a record issued in error. Getting
  that wrong is a compliance defect that looks like a working feature.
- ☐ **P9 — Ops surface.** Pending/blocked/rejected per issuer, both verify routines runnable
  on demand, per-invoice CSV, **certificate expiry countdown** (a representative cert is
  often one year — an unmonitored time bomb), and the alerts "invoice with no record" and
  "record pending > 1 h". *Makes true: "record retention / exportable at any time".*
- 💤 **Cutover.** The production clean-slate deletion (D3), after P5–P7 deploy.

## Log

- **2026-09-29 — Track opened retroactively.** Five phases were already shipped before this
  file existed; the plan's own P0 said to create it and that step was skipped. Recorded here
  rather than quietly backfilled, because the omission is exactly what this system exists to
  prevent: a cold session would have found seven commits and no intent. Earlier commits
  therefore carry `Refs: .claude/tracks/015-cash-sale-receipts.md`, the nearest existing
  track, not 026.
- **2026-09-29 — Founder decisions.** Mode: **Veri\*factu remisión**. Scope: series/chaining
  universal, transmission Spain-only. Live legal page: **left as-is**, gap closed by
  shipping. Existing invoices: **test data, clean-slate delete at cutover** (D3). Track 015's
  production cash backfill: **skipped**, which unblocked P2 immediately.
- **2026-09-29 — Huella provenance.** AEAT's FAQ describes the field list in prose and defers
  the detail to a technical document that could not be retrieved. The order came from a
  third-party implementation citing AEAT and was **independently verified**: its published
  test vector hashes to exactly the stated value. Good evidence, not proof — see D1.
- **2026-09-29 — The accidental mutex.** P2 found that all seven writers' in-transaction
  idempotency re-checks were useless against concurrent callers, and that duplicates had
  been prevented only by the shared counter colliding on `invoice_number` and throwing
  inside a payment transaction. Removing the collision required making the serialisation
  deliberate. `table-deposit.integration.test.ts` had the old behaviour in its title.

## Open decisions

- **D1 — Confirm the huella field order against the official AEAT document** before the first
  real submission. `HUELLA_SPEC_VERSION` is stored per record so a correction stays
  distinguishable, and `PrimerRegistro='S'` restarts a chain, but a format error is only
  discovered once a chain exists. *Highest-cost error in the track.*
- **D2 — Can Sunbnb submit on partners' behalf, and under what instrument** (third-party
  issuance + AEAT *apoderamiento*, colaborador social, or neither)? One platform certificate
  in an env var, or a per-partner encrypted keystore — and there is no secret-storage
  pattern in this repo at all. **Blocks P7; shapes P5.**
- **D3 — The production clean-slate deletion.** Founder chose to delete the 132 test invoices
  rather than freeze them behind a legacy chain, which is what removes the legacy code path
  entirely. Deferred to cutover so the old code cannot re-mint the same numbers; take a dump
  and re-confirm the row count first.
- **D4 — Is Sunbnb a *productor de software* owing a *declaración responsable*?** The legal
  page already claims "certified software (homologado)" and **no engineering phase restores
  that claim** — only a signed declaration does.
- **D5 — F2 ceiling.** Implemented conservatively at €400; hospitality likely qualifies for
  €3,000. Has never bound (largest invoice ever €216) and the classifier REFUSES rather than
  guesses above it.
- **D6 — Legacy data.** 120 invoices carry `"Alonso Beach"` as issuer tax id and 29 credit
  notes carry illegal VAT rates. Both are frozen, not corrected — `buildDesglose` refuses the
  rates so they cannot reach AEAT by accident. D3 removes both when it runs.

## Links

- [[track:015-cash-sale-receipts]] — built the fiscal export and the cash-receipt path; its
  production backfill was deliberately skipped (see Log).
- [[track:018-reservation-state-machine]] — owns the credit-note effect that issues
  rectificativas.
- [[track:017-venue-timezone-anchoring]] — the venue-local day machinery `fechaExpedicion`
  needs.
- [[entity:invoice]] — **stale**: predates `creditsInvoiceId`, the CN series, and everything
  in this track. Fold in via the wiki ingest workflow before P7.
- [[subsystem:payments]] — the agent/marketplace model that decides a consumer receipt shows
  no platform section.
