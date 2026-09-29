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
- `packages/data/src/tax/es-verifactu/huella.ts` — canonical string + serialization helpers,
  now verified against the official spec (D1 closed) and pinned by AEAT's own three vectors.
- `packages/data/src/tax/es-verifactu/tipo-factura.ts` — `classifyTipoFactura`, `buildDesglose`.
- `packages/data/src/tax/regime.ts` — `resolveTaxRegime`, `regimeRequiresRecords`.
- `packages/data/src/invoice-series.ts` — the per-issuer allocator and `lockInvoiceSeries`;
  a record is written in the SAME transaction as its invoice, under the same lock.
- `packages/data/src/payment.ts` — seven writers, each already taking the issuer lock before
  its idempotency re-check.

**No longer blocked.** D2 is closed: Sunbnb submits as a *colaborador social* under Convenio
17, using ONE platform certificate, with each partner's representation collected in-product
(P7a). The record schema can proceed on that assumption.

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
- ☐ **P7a — Capture the representation grant.** AEAT explicitly blesses a web form or
  onboarding pop-up with electronic signature (D2, §16 Q4), so this is a product surface, not
  paperwork: the partner grants Sunbnb representation for VERI*FACTU remission, the grant is
  stored with its timestamp and evidence, and **the submission sweep refuses any partner who
  has not granted it** — *"ningún colaborador social realice envíos sin estar previamente
  autorizado"*. Blocks P7 for any given partner, not P7 as a whole.
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
- ☐ **P9a — The declaración responsable, in the product.** A route in the partner app
  rendering the signed declaration, reachable from anywhere in the software and carrying the
  running version, plus a downloadable copy for resellers and customers. Small, but it is a
  hard requirement of RD 1007/2023 that no other phase covers, and it is the only phase that
  touches the "certified software" line on the legal page (see D4).
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
- **2026-09-29 — Huella provenance, then D1 closed.** The order was first taken from a
  third-party implementation citing AEAT and independently verified against its published
  vector — good evidence, not proof. The official AEAT document was then located and read
  (v0.1.2, 27/08/2024): the field order and format were confirmed correct, and one gap was
  found — values must be TRIMMED, which the implementation was not doing. All three
  official worked examples are now pinned. Also learned from §7, and load-bearing for P7: a
  mismatched huella is "Aceptado con errores", not a rejection.
- **2026-09-29 — D2 closed, and the deadline is NOT what the legal page says.** AEAT's
  developer FAQ v1.3 answers the representation question outright (see D2) and also records
  that **Real Decreto-ley 15/2025 of 2 December moved the compliance dates**: corporate
  income taxpayers from 1 Jan 2026 to **1 Jan 2027**, everyone else from 1 Jul 2026 to
  **1 Jul 2027**. The live legal page's "Compliance became obligatory from 1 January 2026"
  is therefore wrong, and this track's earlier framing of being months past a deadline was
  wrong with it. We are ahead of it, not behind — which changes the urgency but not the
  exposure, since the page still claims a QR that does not exist.
- **2026-09-29 — D5 narrowed.** RD 1619/2012 art. 4 read in full. The simplified-invoice
  ceiling turns out to attach to the ACTIVITY rather than the invoice, so the single
  constant was the wrong model and the classifier now derives the ceiling from line product
  codes, lowest wins on a mixed receipt. F&B is settled at €3,000 (art. 4.2.e); whether
  sunbed and equipment hire are on the list at all is the one question left.
- **2026-09-29 — D4 answered.** AEAT does not certify, approve or homologate billing
  software at all; RD 1007/2023 works by the PRODUCER self-certifying, with no registry and
  no filing. Sunbnb is that producer. Two consequences: the live legal page's "certified
  software (homologado)" describes a mechanism that does not exist, and the declaration must
  be visible INSIDE the software in every version — so this does have an engineering half
  (P9a), contrary to what was recorded when the track opened.
- **2026-09-29 — The accidental mutex.** P2 found that all seven writers' in-transaction
  idempotency re-checks were useless against concurrent callers, and that duplicates had
  been prevented only by the shared counter colliding on `invoice_number` and throwing
  inside a payment transaction. Removing the collision required making the serialisation
  deliberate. `table-deposit.integration.test.ts` had the old behaviour in its title.

## Open decisions

- ✅ **D1 — CLOSED 2026-09-29.** The official document was located and read:
  *"Detalle de las especificaciones técnicas para generación de la huella o hash de los
  registros de facturación"*, AEAT v0.1.2 (27/08/2024),
  `agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf`.
  Field order (alta 8, anulación 5), the `nombre=valor&` format, the empty previous-huella
  for a first record, UTF-8 and uppercase 64-char hex were all **confirmed correct**. One
  gap was found and fixed: §3 requires every value to be **trimmed**, which the
  implementation was not doing. All three of the document's worked examples (§6.1 first
  alta, §6.2 chained alta, §6.3 anulación) are now pinned as tests.
  **Carry forward into P7:** §7 says a huella that disagrees with AEAT's own recomputation
  is *"Aceptado con errores"* — **accepted, not rejected**. A format error therefore never
  announces itself on submission; it accumulates silently down a chain. That is why the
  vectors are tests, and why the response handler must treat accepted-with-errors as a
  failure to investigate rather than a success.
- ✅ **D2 — CLOSED 2026-09-29.** Source: AEAT *"Aclaraciones a dudas de los desarrolladores"*
  v1.3 (4 Dec 2025), §16 — the section is literally titled *"Representación de los obligados a
  emitir facturas (OEF) por parte de las empresas de software. Convenio de colaboración 17"*.
  - **The mechanism is COLABORACIÓN SOCIAL, not a per-partner apoderamiento.** Q1: *"Sí, a
    través de la figura de la colaboración social (artículos 79 a 81 RD 1065/2007 y Orden
    HAC/1398/2003) o del apoderamiento. Pueden ser colaboradores sociales a este respecto
    tanto las empresas suministradoras de software que hayan suscrito el correspondiente
    Convenio de colaboración social como los profesionales de la gestión tributaria."*
  - **Convenio 17 is the one for software companies** (001/002 are for intermediaries). It
    covers exactly our shape — the "direct" case, where the OEF grants representation
    straight to the software company rather than through a gestor.
  - **ONE certificate. Sunbnb's own.** Because Sunbnb submits as the colaborador social, the
    identity on the wire is ours. **P7 therefore needs one platform certificate in encrypted
    env vars, not a per-partner keystore** — the question that shaped this whole phase.
  - **Per-partner authorisation is still required, and may be collected IN-PRODUCT.** Q4 asks
    precisely our question — signing a paper model with every client is costly — and answers:
    *"la utilización auxiliar de formularios web, pop-ups al iniciar la relación o cualquier
    otro sistema informático que asegure que el uso del API de remisión solo se produce tras
    el otorgamiento y aceptación de la representación es perfectamente válida"*, provided the
    grant is completed and signed, electronic signature included. See **P7a**.
  - **Never submit for a partner who has not granted it:** *"ningún colaborador social realice
    envíos sin estar previamente autorizado"*. The originals can be demanded if an
    irregularity arises, so the grants must be retained as evidence.
  - **To sign Convenio 17**, send to the local Delegación or `comunicacion.sepri@correo.aeat.es`:
    a formal request under art. 92 Ley 58/2003; the entity's name and NIF; the statutes article
    covering the objeto social; the name/NIF of the signatory plus either a secretary's
    certificate of appointment or an escritura de apoderamiento; and a contact name, NIF,
    phone, address and email. **Founder action — nothing engineering can do for this one.**
  - A standardized per-partner model also exists (Anexo II, Resolución DG AEAT 18-12-2024,
    BOE 31-12-2024) if a paper route is ever preferred.

- **D3 — The production clean-slate deletion.** Founder chose to delete the 132 test invoices
  rather than freeze them behind a legacy chain, which is what removes the legacy code path
  entirely. Deferred to cutover so the old code cannot re-mint the same numbers; take a dump
  and re-confirm the row count first.
- ◐ **D4 — ANSWERED 2026-09-29; one signature and one screen outstanding.** Source: AEAT FAQ
  *"Certificación de los sistemas informáticos: declaración responsable"*.
  - **Sunbnb is the obligated party.** The declaration is issued by "la persona o entidad
    productora del sistema informático" — the producer, not the partner using it. It applies
    even to software a company builds only for itself, so there is no reading under which
    this falls to the venues.
  - **There is no such thing as AEAT-certified or homologated billing software.** The FAQ
    is explicit that this is *auto-certificación* by the producer: "no se requiere de
    procesos de certificación realizados por otras personas, entidades u organismos
    independientes", and "no se prevé ningún registro previo del producto". No approval, no
    registry, no list to be on. **The live legal page's claim of "certified software
    (software de facturación homologado)" therefore describes a mechanism that does not
    exist** — that is not an unkept promise like the QR, it is a wrong statement about how
    the regime works, and it is the one line on that page that shipping cannot make true.
    Founder decision needed on the wording; not edited here, since it is a legal document.
  - **Not filed with AEAT.** The producer keeps it and produces it on request, from either
    the tax administration or a customer.
  - **Contents:** data identifying the system — its type, composition, functionality and
    installation characteristics — plus the producer's identifying and location data, and
    the date and place of signing.
  - **I was wrong that no engineering phase touches this.** Requirement: it must appear "por
    escrito y de modo visible en el propio sistema informático en cada una de sus versiones",
    reachable quickly from any point in the software, AND be available externally to a buyer
    or reseller in a free, widely-used format. The second half is a PDF the company
    publishes; **the first half is a screen we have to build** — see P9a.
  - **Remaining:** the founder signs the declaration (content is drawable from the bullet
    above), and P9a ships the in-app surface.
- ◐ **D5 — NARROWED 2026-09-29 to one question.** Source: **RD 1619/2012 art. 4** (BOE),
  read in full. General ceiling €400 incl. VAT; €3,000 for a closed list of activities.
  - **The ceiling attaches to the OPERATION, not the invoice** — which was the real finding.
    A beach club selling drinks and lounger hire at the same counter is under two different
    ceilings, so a single constant was the wrong model. `simplifiedCeilingFor` now derives it
    from the line product codes and takes the LOWEST on a mixed receipt: a receipt is not
    covered by the higher limit merely because half of it would be.
  - **Settled:** `food-and-beverage` and `no-show-deposit` are *servicios de hostelería y
    restauración* (art. 4.2.e) → €3,000. The clearest entry on the list for a chiringuito.
  - **The one remaining question for the asesor:** do `sunbed-rental` and `equipment-rental`
    fall within the art. 4.2 list at all? Hiring a lounger is not a *venta al por menor*
    (nothing is sold) and a sunbed is not an *instalación deportiva*; equipment hire has a
    better claim to 4.2.i but it is an argument, not a fact. Both are held at the general
    €400 in the meantime. Being wrong that way costs nothing today — the largest invoice
    ever issued is €216 — while being wrong the other way files a real sale as the wrong
    document type.
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
