---
id: 026-verifactu
title: Veri*factu — Spanish fiscal compliance for receipts and invoices
status: active
created: 2026-09-29
updated: 2026-10-04
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

**Every code phase but P6a is complete. The transport covers every authorised issuer and
needs no further deploy to go live — the next actions are the certificate and the Convenio,
both external.**

### What P7.2 changed about this section

The sweep is no longer scoped to our own NIF, and it is safe to run that way *before* the
Convenio is approved: an AEAT refusal (`4112`) parks a partner's records and retries them
rather than blocking them, so the first sweep after approval simply succeeds. Nothing below
is gated on P7.2 any more.

### What is ready

`submitPendingRecords()` — the `*/15` cron in `apps/admin/vercel.json` — sends our own
commission invoices AND every partner who has granted submission, with us named as
`Representante`. The client defaults to **stub** so nothing happens until a certificate is
configured, and `AEAT_MODE=http` with no certificate **throws** rather than degrading.
`AEAT_ENV` defaults to `pruebas`. `submitPlatformRecords()` is retained as the
nothing-external sweep: the right first proof against preproducción.

### To go live, in order

0. **Each Spanish partner accepts at `/account/verifactu`** (P7a) — two grants, and the
   submission one is what the sweep checks. Until then their records queue as
   `no-grant-on-file`, which is correct rather than broken.
1. **Set `taxRegion` on each Spanish partner** — now possible: the admin partner page has a
   Tax Identity card with a province dropdown (P7b). Until it is set, `resolveTaxRegime`
   returns `NONE` and that partner's invoices are out of scope rather than filed, which is why
   `verifactu:health` refuses to call the register complete while any remain.
2. **Re-save the business entity on admin `/platform`** — a one-click backfill, not a
   mislabelling fix. **Correction to an earlier entry in this track:** it is NOT a defect that
   the Spanish company's identity sits on a `Settings` row whose `country` is `FI`. Platform
   identity is a deliberate **singleton copied onto every per-country `Settings` row**
   (`saveBusinessEntity` does `updateMany` with no `where`, and says so), and `Settings.country`
   is the per-country VAT/currency table — not a statement about who issues. What is real is
   narrower: the `ES` row has a NULL `vatId`/`companyName` because the fee-context bootstrap
   (`ensureSettingsAndFee`) created it AFTER the last identity save, and nothing has copied the
   identity onto it since. `getBusinessEntity()` already resolves correctly regardless, because
   `readIdentityRow` prefers a row that HAS a `vatId` — so this is tidiness, not a blocker.
2. **Obtain the FNMT certificate** (€14, 2 years, online accreditation for our B-prefix NIF).
   See *Founder actions*.
3. **Run against preproducción from a laptop**: set `AEAT_CERT_PFX_BASE64`,
   `AEAT_CERT_PASSWORD`, `AEAT_MODE=http`, `AEAT_ENV=pruebas`, then
   `npm run verifactu:health:local` → sweep → health again. This is the manual gate that
   cannot run in CI, because preproducción needs a real certificate.
4. **Then production**: `AEAT_ENV=production` in Vercel for the admin app only.

**Check before and after every step with `npm run verifactu:health:{local,test,production}`.**
Note `verifactu:health:production` cannot run until the migrations reach production.

### The Convenio, and why nothing waits on it

Convenio 017 (colaboración social) is the remaining external dependency for PARTNER records
only. Our own commission invoices need none of it. Nothing needs to be built or deployed when
it is approved: the sweep already tries, AEAT already answers `4112`, and the records are
parked rather than blocked precisely so that approval is self-acting. `verifactu:health` and
admin `/verifactu` report the parked count while it is pending.

**Open and worth knowing:** **D6** (how a reverse-charge commission invoice is declared) blocks
our own invoices to the Finnish partner — they are refused rather than mis-declared, and show
up in `verifactu:health`. D4's signature and half of D5 remain founder/asesor actions. The
production clean-slate deletion (D3) is deferred to cutover. `packages/data` still has no
typecheck script (111 pre-existing errors, none in the Veri\*factu files) — the gap that let a
missing `select` field through in P7.1a.

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
- ✅ **P5 — ES record generation** (`737a28d`, `77df2fa`, `ce6b4e2`, `b21a85f`). The huella
  verified against AEAT's own published vectors (D1), `TipoFactura` classification,
  `buildDesglose` refusing null and illegal rates, the `VerifactuRecord`/`VerifactuChain`
  schema, and a record written inside the invoice's own transaction from all twelve
  `tx.invoice.create` sites across the seven writers. Fixed on the way: `issueCashCreditNote`
  derived an effective rate as `totalTax/totalCharge*100`, producing stored rates of
  20.98/21.01/21.03 that AEAT rejects outright — all 29 production credit notes are
  unfilable as they stand, and credit notes now carry one line per original rate.
  **Two defects the wiring itself produced, both worth remembering:** the record call first
  sat immediately after `tx.invoice.create`, which reads correctly and silently blocked every
  ES record for having no `Desglose` — it is built from the invoice LINES, which are written
  afterwards; and the platform's own jurisdiction was a constant `ES`, which would have filed
  the Finnish group entity's commission invoices to AEAT under a NIF it has never heard of
  (it is now a function of the issuing tax id). Neither is visible to a unit test of the
  builder; both were caught by an integration test that drives `processConfirmedReservation`
  end to end. Keep that test — it is the only thing proving the builder is CALLED.
- ✅ **P6 — QR and the VERI\*FACTU legend** (`e1adb95`, `976a94f`). Built against AEAT's own
  spec (*Detalle de las especificaciones técnicas del código «QR»…*, **v0.5.0, 10/12/2025**),
  not from recall — its §4 and §8.1 worked examples are pinned as tests, including the one
  that exists to show the failure: an invoice number containing `&`, which unencoded turns
  the URL into a different, valid-looking request. **The payload carries no CSV** (§6:
  nif + numserie + fecha + importe), which is what makes P7's asynchronous transport lawful,
  and a test asserts the parameter set so nobody can later make the checkout block on AEAT.
  The gate is `ReceiptModel.fiscal`, computed once so all four presenters inherit one regime
  decision — null for the Finnish partner and for a foral issuer. `ES_ISSUER_TIME_ZONE` is
  now shared with the record builder, because the QR's `fecha` is cotejed against the
  record's `FechaExpedicionFactura` and deriving it twice would fail every scan while every
  unit test passed. The PNG route is keyed on `invoiceId`, never on the payload: an endpoint
  taking `nif`/`importe` would draw a QR claiming any amount for any tax id.
  `qrcode` margin is **0** on purpose — art. 21.1 measures the CODE at 30–40 mm and a baked-in
  quiet zone leaves it at ~76% of the printed size, so the presenters supply the zone as white
  padding; verified by decoding the generated PNG with CoreImage (both margin-0 and margin-4
  round-trip to the exact URL). *Makes true: "every receipt includes a QR code formatted per
  AEAT specifications" — the most conspicuous false claim on the live page.*
- ✅ **P7.0 — The missing-record detector** (`2a2a458`, `6a12838`).
  `getVerifactuHealth` + `describeVerifactuHealth` in
  `tax/es-verifactu/health.ts`, wired the same day as
  `npm run verifactu:health:{local,test,production}` (exit 1 when unhealthy, so it can gate a
  cron or CI). Reports: in-scope invoices with no record split by `issuerType`, records by
  submission state, the oldest unsent record, and per-issuer chain contiguity — `chainSeq` runs
  1..N, so a count below the chain head means a record inside the chain is GONE, which
  re-sending cannot repair. Extracted `resolveInvoiceIssuerJurisdiction` and `RECORD_*` status
  constants out of `record.ts` so the detector cannot disagree with the writer about scope or
  about what "filed" means.
  **Running it found three things no test would have.** (a) It first reported *"register
  complete"* on TEST with zero records — because no partner has `taxRegion`, so nothing was
  ever in scope: the same shape as the refunds figure this track already fixed, structurally
  always €0.00 while €576 had been credited. `unresolvedEsIssuers` now names that and
  `healthy` is false while any remain. (b) All 8 PLATFORM invoices on TEST are unfilable —
  seven with a NULL tax id and the name "Platform Operator", one carrying a *partner's*
  Finnish VAT number as the issuer of our own commission invoice. (c) The platform `vatId` is
  stored as `ESB22435705` with the country prefix, so `foldNif`'s prefix stripping is
  load-bearing: without it every commission invoice of ours resolves to a different company
  and drops silently out of scope.
- ✅ **P7.1a — The wire payload, built from AEAT's XSD** (`3053012`). AEAT's schemas are
  committed under `src/tax/es-verifactu/schemas/`; `registro-xml.ts` builds the
  `RegistroFactura` fragment and the `RegFactuSistemaFacturacion` envelope from them. The
  fragment is generated inside the invoice's transaction and **frozen** in `payload_xml`
  (migration `20260930140000` adds the four fields the huella did not cover), for the reason
  the schema already gives for `issuerNif`: rebuilding it at send time would let an invoice
  edit change what gets filed, and a mismatched huella is *"aceptado con errores"* rather than
  rejected, so the drift would be silent.
  **Four things the XSD corrected that recall would not have.** `Cabecera` is declared locally
  in `SuministroLR.xsd`, so the ELEMENT is in the LR namespace while its TYPE comes from the
  other schema (the first generated document was invalid on exactly this).
  `SistemaInformaticoType` requires `TipoUsoPosibleSoloVerifactu`, `TipoUsoPosibleMultiOT` and
  `IndicadorMultiplesOT`, which we did not have — all `S`, all describing the SYSTEM, so they
  must stay consistent with D4's declaration. `DetalleDesglose` requires
  `CalificacionOperacion` (`S1` for an ordinary taxed domestic supply). And
  `RegistroAnterior` needs the previous record's whole identity, not just its hash.
  **The bug worth remembering:** the chain read selected `lastHuella` and `lastChainSeq` but
  not `lastRecordId`, which the new chaining code then read — so every record would have
  emitted `PrimerRegistro` and silently restarted the chain on every invoice. Lint cannot see
  it (`packages/data` has no typecheck); the test that the second record chains onto the first
  is what caught it.
  Verified by `xmllint` against `SuministroLR.xsd`, including **what the real writer stored**
  rather than only a hand-built document, plus a negative case proving the validation
  discriminates.
- ✅ **P7.1b — The client, the sweep and its cron** (`856c16f`). `soap.ts` (SOAP 1.1,
  document/literal, empty `soapAction`, all from the committed WSDL), `client.ts`
  (`AEAT_MODE=stub|http`, **throws** in explicit http mode with no certificate, defaults to
  the `pruebas` endpoint and the non-Sello host), `submit.ts` (DB-state-as-queue with the
  attempt counter, backoff and terminal `blocked` state `/api/reconcile` lacks), and the cron
  in `apps/admin` wired into `vercel.json` in the same commit. `turbo.json` `globalEnv` gained
  the AEAT variables and `CRON_SECRET`, which was missing despite three crons depending on it.
  **`AceptadoConErrores` is an ACCEPTANCE**, not a failure — AEAT holds the record and the
  errors need a later *subsanación*. Treating it as failure resends what AEAT already has;
  treating it as plain success hides a real defect, and per huella spec §7 a mismatched huella
  arrives exactly this way, so this branch is the only thing that would tell us the chain is
  wrong. `RegistroDuplicado` also counts as accepted — the idempotency signal that makes a
  lost reply recoverable.
  **The sweep stops at the first failure per issuer**, on a rejection *and* on a reply that
  omits a record. Chain order is mandatory, so head-of-line blocking is correct, and the code
  says so to stop a maintainer "fixing" it into a compliance breach. Replies are matched by
  invoice number, never by position.
  **The bug worth remembering:** the platform filter compared the bare NIF while the `Settings`
  row stores `ESB22435705`, so the sweep would have matched nothing and reported a clean empty
  run — a silent no-op that looks like success. `platformIssuerNifCandidates()` passes both
  spellings, because SQL cannot fold the prefix the way `foldNif` does.
- ✅ **P7a — The partner's authorisations, captured and enforced** (`<this commit>`).
  **TWO grants, not one**, because they are separate legal acts resting on different provisions
  and gating different things — a single "agreed to Veri\*factu" flag would misstate what was
  agreed:
  `invoicingAuthorityGrantedAt` (art. 5 RD 1619/2012 — we expedite invoices in their name, which
  every record already declares via `EmitidaPorTerceroODestinatario=T`) and
  `aeatSubmissionGrantedAt` (colaboración social — we submit their records). Stored separately
  with a `termsVersion`, so a later rewording cannot retroactively claim a partner agreed to text
  they never saw, and with evidence of who accepted, when and from where.
  **The gate is on SUBMISSION, not on generation.** A partner who has not granted still gets
  records — they are owed regardless, and withholding them would recreate the gap phase 5 exists
  to avoid. Their records stay **`pending`**, deliberately not `blocked`: blocked is
  terminal-until-fixed and stops retrying, whereas these must go out untouched the moment the
  grant arrives. The sweep reports them as `awaitingAuthorisation`.
  **Our own invoices are never gated** — there is no third party on a PLATFORM commission
  invoice, and `4112` accepts the certificate holder as *Obligado Emisión*.
  Partner surface at `/account/verifactu`, shown to Spanish partners only, stating plainly what
  the authorisation does NOT do: it hands over no certificate, authorises nothing else at AEAT,
  and moves no liability. Built now rather than later so the grant is actually obtainable —
  the `taxRegion` lesson, where the instruction existed and the mechanism did not.
  Admin `/verifactu` lists every Spanish partner's grant state **with the count of records the
  missing mandate is holding up** — a row that says what it costs, rather than merely that
  something is absent. A partner showing `none` is called out specifically: we are already
  issuing invoices in their name with no mandate on file.
- ✅ **P7.2 — Transmission, partners** (`<this commit>`). The cron now calls
  `submitPendingRecords` (every authorised issuer) rather than `submitPlatformRecords` (only
  our own NIF), and `sweepOneIssuer` puts `COLABORADOR_SOCIAL` in the `Cabecera`'s
  `Representante` whenever the obligado is somebody else. `buildSubmissionXml` already
  supported the element, so that half really was the two-line change the plan predicted.
  **The half the plan did NOT predict, and the reason this is not a filter flip.** Shipping
  the widening alone would have sprung a trap on the first partner to accept at
  `/account/verifactu`: `4112` arrives as a SOAP Fault, `sweepOneIssuer` treated every fault
  as terminal, and terminal means `blocked` with `nextAttemptAt: null` and no retry. So a
  partner who had done everything right would pass our own grant gate, be refused by AEAT for
  want of a Convenio nobody had approved yet, and have their entire register go terminal
  pending manual repair — the exact outcome P7a's "deliberately NOT blocked" paragraph exists
  to prevent, reintroduced one layer down.
  **So there are TWO authorisation gates, and the second one is AEAT's.** Our database knows
  whether a partner has granted; only AEAT knows whether the Convenio registering us as their
  colaborador social is approved, and `ERROR_NOT_ENTITLED` is how it says so.
  `deferForAuthorisation` parks such a batch: status stays `pending`, a long
  `AUTHORISATION_RETRY_MS` (6 h, because the thing being waited on is an administrative
  approval, not a socket) and — the subtle part — **`attempts` is NOT incremented**. Counting
  an authorisation gap toward `MAX_SUBMISSION_ATTEMPTS` would have blocked the records anyway,
  a fortnight later, for a reason that no longer applied. A test runs the refusal
  `MAX_SUBMISSION_ATTEMPTS + 3` times and asserts `attempts === 0`.
  **There is deliberately no local "Convenio approved" switch.** AEAT is the authority on its
  own register, so the code asks it and self-heals; a flag an operator has to remember to flip
  is how `taxRegion` held every Spanish invoice out of scope while the report read clean.
  Which also means **this phase needed no deploy to go live** — the first sweep after the
  Convenio is approved simply succeeds.
  **Wired its own visibility, per the plan's rule.** A parked record is `pending`, which is
  indistinguishable from "the cron has not got to it yet" — and those call for opposite
  responses (nothing, versus chase AEAT for a partner who has already signed). So
  `getVerifactuHealth` gained `parkedAwaitingAuthorisation`, identified STRUCTURALLY rather
  than by matching the error text (`deferForAuthorisation` is the only writer that leaves a
  record `pending` with `lastAttemptAt` set), it counts against `healthy`, and the ops page
  names it in amber. Health going red for the duration of an AEAT approval is the lesser evil
  against a banner reading "register complete" over records nothing will send.
  Kept `submitPlatformRecords` — it is the one sweep depending on nothing external, so it
  stays the right first live proof against preproducción and the right fallback if the
  Convenio is ever withdrawn. A test pins the cron to the WIDE sweep, because narrowing it
  back would silently stop filing every partner while every other test still passed.
- ✅ **P8 — Subsanación and anulación** (`9587a5d`, `<this commit>`).
  **Subsanación** closed a gap in shipped code: the sweep handled `AceptadoConErrores` by
  marking the record `sent` and storing the message, leaving AEAT holding a document we knew
  was defective with nothing able to act on it — and per huella spec §7 that is exactly how a
  **wrong huella** arrives, so the one signal that would reveal a broken chain was dying in a
  column. **Anulación** voids a record that should never have been issued.
  **Both case mappings came from the operations tables in AEAT's validations document**, not
  the XSD, whose documentation for `Subsanacion` and `RechazoPrevio` is a copy-paste error
  reading "Clave del tipo de factura".
  Subsanación: held by AEAT → `S` alone; never reached AEAT → `+X`; a previous *correction*
  rejected → `+S` (the subtle one — such a record is both a SUBSANACION and not-at-AEAT, and
  the obvious branch picks the wrong flag).
  Anulación: two INDEPENDENT axes, not alternatives — `SinRegistroPrevio` (AEAT does not hold
  it) and `RechazoPrevio` (a previous annulment was rejected). All four combinations are legal.
  **The distinction that matters most, stated in both modules:** a refund is NOT an anulación.
  The sale happened and its record is true; the correction is a credit note, filed as an ALTA
  of a rectificativa, which `payment.ts` already does. Annulling a refunded sale would erase
  the record of a real transaction. An anulación is for an invoice that should not exist at all.
  Neither is automatic — both re-send or void based on a judgement about why AEAT objected, and
  an automatic version would either reproduce an error forever or erase real sales. Wired as
  `verifactu:subsanar:*` (lists candidates by default) and `verifactu:anular:*` (dry run unless
  `--confirm`).
  **Known limit:** one SUBSANACION and one ANULACION per invoice, capped by
  `@@unique([invoiceId, recordType])`. Lifting it needs a partial unique index limited to
  `('ALTA')`, which Prisma cannot express in schema.
- ☐ **P6a — Our OWN commission invoice has no rendered document.** Found while closing P6: a
  PLATFORM invoice gets a record, but nothing anywhere renders it as an invoice a human can
  read — the partner accounting page shows list rows and a CSV column, and there is no PDF or
  printable page. So art. 20's QR + legend requirement has **no surface to attach to** for the
  B2B commission invoice, which is why P6 did not cover it. A partner needs that document for
  their own books, and the moment it is built it must carry the QR and the legend.
- ✅ **P9a — The declaración responsable, in the product** (`<this commit>`). Built from AEAT's
  published *Ejemplos de declaraciones responsables*, so the section lettering (1.a–1.l plus the
  2.a–2.c annex) and the §1.k compliance wording are theirs, not invented.
  **The invariant that makes it worth having as code rather than a static page:** §1.a, §1.b,
  §1.c, §1.e, §1.f, §1.h and §1.i all restate facts that travel inside the `SistemaInformatico`
  block of **every record we file**. A declaration disagreeing with them is a false statement
  about the software in use. So they are derived from `sistemaInformatico()` and a test asserts
  the two agree — in particular §1.c tracks the RUNNING version, since the obligation is a
  declaration per version and a hardcoded one would be wrong on the next deploy.
  **It renders as UNSIGNED until signed**, with a banner saying so, because an unsigned
  declaration is not one and presenting it as such would be the same class of false claim this
  phase exists to remove. Signature comes from `VERIFACTU_DECLARATION_SIGNED_ON` / `_AT`
  (D4 remains the founder's action).
  **Also corrected the live legal page.** It claimed receipts must be generated by "certified
  software (software de facturación homologado)" — which D4 established is simply untrue: AEAT
  homologates nothing. That line now says what is actually required, states that AEAT does not
  certify invoicing software, and links to the declaration. It is the one claim on that page
  that no amount of shipping could make true.
- ✅ **P9 — Ops surface** (`<this commit>`). Admin `/verifactu`, sudo-gated, bringing together
  what was previously only reachable by CLI: health, submission states, per-issuer chain
  integrity, invoices with no record, records needing correction, unclassified Spanish issuers,
  and the transport's mode/environment.
  **Read-only on purpose.** Everything that changes a filing — correcting, voiding — stays
  behind `verifactu:subsanar` / `verifactu:anular`, because both act on a judgement about why
  AEAT objected and neither belongs behind a button someone hits while scanning a dashboard.
  **Certificate expiry is read FROM the certificate**, not from a setting. `certificate.ts`
  parses the configured PKCS#12 with `node-forge` (now a declared dependency of `@repo/data`
  rather than borrowed transitively from Expo) and reports subject, issuer and days remaining.
  An operator-entered date would be exactly as wrong as the day it was mistyped, and the stakes
  are specific: an FNMT certificate **cannot be renewed once expired**, and a lapse fails at the
  TLS handshake — which reads as a network fault while records quietly queue. Warning window is
  **60 days**, because replacement needs a tax-office appointment whose lead time we do not
  control. It returns metadata only: never the key, never the passphrase, and the error string
  deliberately does not echo the attempted password, since it is rendered on a web page.
  **One real bug found by testing it:** forge hands back certificate attributes as BINARY
  strings, so "Sunbnb España SL" rendered as mojibake — on the one screen meant to prove we know
  what we are filing with. Fixed with a UTF-8 decode. (The test fixture needed openssl's `-utf8`
  to stop double-encoding and making the fix look broken.)
- 💤 **Cutover.** The production clean-slate deletion (D3), after P7.1 deploys.

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

- **2026-09-30 — P5 closed; the generator is wired and the wiring was where the bugs were.**
  The remaining half of P5 landed: the `VerifactuRecord`/`VerifactuChain` schema
  (migration `20260929160000`), records generated inside the invoice transaction, and calls
  from all twelve `tx.invoice.create` sites. Both defects found were in the WIRING rather
  than in the generator, and neither was reachable from a unit test.
  (1) The call was placed beside the invoice header, before `tx.invoiceLine.createMany` —
  so `buildDesglose` saw no lines and every Spanish invoice came back
  `blocked: "an invoice with no lines has no VAT breakdown to declare"`. The code read as
  obviously correct; only driving `processConfirmedReservation` end to end exposed it.
  (2) `PLATFORM_ISSUER_JURISDICTION` was a constant `{ES, MA}`. But `getBusinessEntity()`
  reads a `Settings` row and there is more than one — the platform has a Finnish entity too —
  so a commission invoice it issued would have been filed to AEAT under a Finnish VAT id.
  It is now `platformIssuerJurisdiction(issuerVatNumber)`, and anything that is not the
  Spanish entity's NIF is out of scope: not filed anywhere beats filed in the wrong place.
  Also fixed the sibling trap in the same branch — a PLATFORM invoice's `accountId` is the
  RECIPIENT partner, so resolving the regime off it would file our invoice under the
  customer's jurisdiction. Full suite green: 439 data integration tests, all 9 turbo tasks,
  three apps typecheck, `migrate:check` clean.

- **2026-09-30 — P6 shipped: the QR is real, and the spec was worth fetching again.** Same
  method as D1 — read AEAT's published document rather than trusting recall — and it paid
  twice. The spec is now **v0.5.0 (10/12/2025)**, newer than the model's knowledge, and it
  fixes two things a plausible implementation would have got wrong: `formato=json` must
  **never** appear in a QR's URL (§7.2), and art. 21.1's 30–40 mm is the size of the CODE, so
  a quiet zone baked into the PNG pushes the code under the legal minimum. Verified the second
  by decoding both variants with CoreImage rather than reasoning about it — margin 0 still
  scans, so the presenters can own the quiet zone.
  Also confirmed the property the whole transport design rests on, from §6 directly: the
  payload is nif + numserie + fecha + importe and **nothing AEAT returns**, so the receipt is
  complete before submission. There is now a test asserting exactly that parameter set.
  One gap found and recorded rather than quietly skipped (P6a): our own PLATFORM commission
  invoice gets a record but has no rendered document anywhere, so there is no surface for its
  QR yet.

- **2026-09-30 — The Convenio is a technical gate, not just a legal one — and it does not block
  all of P7.** Asked whether the €14 certificate is technically sufficient. It is a real
  qualified certificate and exports to `.p12`, so it runs on a server; but AEAT enforces
  representation at the service: `4112 = El titular del certificado debe ser Obligado Emisión,
  Colaborador Social, Apoderado o Sucesor`, in the list of errors that **reject the whole
  envío**. Treating the Convenio as paperwork would have produced a transport that authenticates
  cleanly and has every submission rejected.
  The same error code carries the way forward: *Obligado Emisión* is an accepted role, and we
  are the obligado on our own PLATFORM commission invoices. P7 can therefore be built and
  proven end to end against production AEAT with only the certificate — no Convenio, no partner
  signature — which is now the recommended first slice. Partner submission stays gated on P7a.

- **2026-09-30 — Roadmap resequenced after establishing what the certificate actually buys.**
  P7 had looked blocked behind two external processes (an FNMT certificate and an AEAT Convenio),
  which would have left the transport unwritten for weeks. Establishing that `4112` accepts
  *Obligado Emisión* changed that: we are the obligado on our own commission invoices, so the
  transport is fully buildable and provable against production AEAT on the certificate alone.
  P7 is therefore split — **P7.1 platform-issuer** (unblocked now) and **P7.2 partners** (a
  filter widening behind P7a and the Convenio).
  Also pulled the **missing-record detector out of P9 and put it first as P7.0**. It is a debt
  this track created: P5 deliberately writes no record for a blocked invoice and justified that
  in `record.ts` by pointing at an alert that was never built, so a blocked invoice is currently
  invisible outside a Vercel log. It is also the instrument that tells us whether our own
  commission invoices are filable before P7.1 starts sending them.
  Corrected a figure repeated several times in this track: **4** unpushed migrations, not 5.

- **2026-09-30 — P7.0 shipped, and it earned its place by failing usefully on first run.**
  The detector said *"Veri\*factu register complete"* against the TEST database while holding
  zero records, because `resolveTaxRegime` returns `NONE` for a `country = 'ES'` partner whose
  `taxRegion` is unset — so no invoice was ever in scope and every figure read clean. That is
  the third instance in this track of the same defect shape: a number that cannot be wrong
  because nothing reaches it (the others being `fiscal.ts`'s refunds, always €0.00 beside €576
  of credit notes, and the `Desglose` built before the invoice lines existed). The report now
  names unclassified Spanish issuers and refuses to call itself complete while any exist.
  It also surfaced that all 8 PLATFORM invoices on TEST are unfilable, one of them issued
  under a partner's Finnish VAT number, and that the platform's stored `vatId` carries an `ES`
  prefix — making the prefix folding in `platformIssuerJurisdiction` load-bearing rather than
  defensive. Both now have tests.
  Wired as a CLI in the same commit, per this track's own rule: `/api/reconcile` is the
  standing proof that a route shipped without its trigger stays dark forever.

- **2026-09-30 — P7.1a: the payload, and a reminder that fetching the schema beats recalling
  it.** Four separate details in AEAT's XSD would have been wrong from memory, and the one that
  actually broke the first generated document was the subtlest: `Cabecera` is declared locally
  inside `RegFactuSistemaFacturacion`, so the element sits in the `SuministroLR` namespace
  while its type comes from `SuministroInformacion`. `xmllint` named the element and not the
  reason. Schemas are now committed so this is checkable offline.
  The record as phase 5 stored it could not build the document — it kept what the *huella*
  needs, which is a strict subset of what the *XML* needs. Four additive columns and the frozen
  `payload_xml` close that, and the freezing is deliberate: a payload rebuilt at send time
  could disagree with the hash that certifies it, and AEAT would answer *"aceptado con
  errores"* rather than rejecting it, so nothing would surface the drift.
  New open decision **D6**: a reverse-charge commission invoice is not a 0% taxed supply, and
  `buildDesglose` now refuses it rather than declaring `S1` at 0.00. Our invoices to the
  Finnish partner are consequently blocked and visible in the health check — the honest state.
  Process note: the `lastRecordId` bug (every record emitting `PrimerRegistro`, silently
  restarting the chain) reached the tests because **`packages/data` has no typecheck script**.
  `npx tsc --noEmit --rootDir .` works and reports 111 pre-existing errors, none in the new
  files, mostly `ServiceFee` test fixtures missing `product`. Worth its own task — the package
  all three apps depend on is the one with no type gate.

- **2026-10-01 — P7.1 complete: the transport exists and is stub-safe by default.** Nothing
  reaches AEAT until a certificate is configured, and `AEAT_MODE=http` without one throws
  rather than degrading — the one failure mode worse than not submitting is believing we did,
  which a stub fallback would produce at scale.
  Two judgements worth keeping. **`AceptadoConErrores` is an acceptance**, so it marks the
  record `sent` while preserving the error text; it is also the only channel through which a
  wrong huella would ever surface (§7), which is why it is not collapsed into success.
  **The sweep halts per issuer on the first failure**, including when a reply simply does not
  mention a record — silence is not consent, and the next sweep must resume from the gap.
  The bug found before the first test run is the instructive one: the platform filter compared
  the bare NIF against stored values that carry an `ES` prefix, so the sweep would have found
  nothing and reported a clean empty run. A no-op that looks like success is the worst shape a
  compliance bug can take, and it is the second time this track has hit that shape after the
  health check reporting "register complete" over zero in-scope invoices.

- **2026-10-02 — P7b: made the instruction I had given actually followable, and corrected a
  claim.** The track told the operator to "set `taxRegion` in admin". That was impossible:
  phase 3 added the column and **nothing anywhere could write it** — it appeared in no app
  outside the code that reads it. So the headline blocker on going live was an instruction with
  no mechanism, and no Spanish partner could ever be in scope.
  Building the UI surfaced a worse latent bug in `resolveTaxRegime`: it returned `ES_VERIFACTU`
  for **any** non-empty, non-foral string. A hand-typed `"BIZKAIA"`, `"Bilbao"` or `"PV"` would
  have filed a foral taxpayer's records to AEAT — exactly what `ES_FORAL_UNSUPPORTED`'s own
  comment calls worse than filing nothing. The province list is now closed (52 codes), an
  unrecognised value resolves to `NONE`, and Canarias/Ceuta/Melilla get their own
  `ES_INDIRECT_TAX_UNSUPPORTED` because IGIC/IPSI are not IVA (**D7**).
  **A correction:** I had recorded "the Spanish company's identity sits on a `Settings` row
  labelled `country = FI`" as a blocking data defect. It is not. Platform identity is a
  singleton deliberately copied onto every per-country row, and `country` there is the VAT
  table, not the issuer. The real residue is only that the `ES` row has a NULL `vatId` because
  the fee-context bootstrap created it after the last identity save; `getBusinessEntity()`
  already prefers a row that has one. Downgraded from blocker to tidiness.

- **2026-10-02 — FNMT recommends a different certificate than the one this track assumed.**
  Asked to obtain the certificate directly; declined — it needs the company NIF, the
  administrador's identity document, a password protecting a qualified credential, and a card
  payment, and the product is a credential that can act as the company. Read FNMT's pages
  instead, which turned up something that changes the plan: their *Certificados electrónicos
  válidos para el sistema VERI\*FACTU* page recommends the **Sello de Entidad** for "una
  plataforma en la nube" doing "firma automática y desatendida" — our exact shape — and says
  such certificates require a **different web-service endpoint**, the `www10`/`prewww10` pair
  I had already put in `ENDPOINTS` and deliberately marked unused.
  Opened as **D8** rather than acted on, because two things are unverified: whether FNMT sells
  a Sello self-service at all (the sede's company section lists only the three Representante
  variants), and whether a Sello is accepted as a *colaborador social* for third-party
  partners, which P7.2 depends on. Also confirmed the real prices (29,04 € / 16,94 € inc. IVA)
  and a **7-day refund window** that auto-revokes an unused certificate — so this decision is
  reversible if taken quickly.

- **2026-10-03 — Closed the "nothing exercises all of this together" gap, and verified the
  endpoints for real.** Seven phases had shipped with each seam tested in isolation, which is
  precisely the shape that let a blocked `Desglose` and a silently-restarting chain through.
  `lifecycle.integration.test.ts` now drives one Spanish sale through
  `processConfirmedReservation` and asserts the whole chain of consequences: two invoices under
  the agent model, one ALTA each with the right `TipoFactura` on separate issuer chains, a
  huella that recomputes from its own stored input, a verifying invoice chain, a receipt whose
  QR names that invoice and carries no CSV, a health check that is green before submission and
  reports the queue, the platform-only sweep leaving the partner's record queued, and the
  register reporting itself complete afterwards. Plus the same documents validated against
  AEAT's XSD, and a Finnish sale confirmed to produce nothing at all. It passed first run,
  which is the first real evidence the phases compose.
  Also probed the live AEAT endpoints (see *Founder actions* A1b): both are up, both request a
  client certificate, `prewww1` accepts FNMT's `AC REPRESENTACIÓN G2` — so the certificate
  being obtained will be accepted at the TLS layer — and the `…Sello` host accepts
  `AC ENTIDADES G2` instead, empirically confirming the endpoint split the code already
  encodes. The only thing left that a certificate unlocks is AEAT's application-level verdict
  on our document content.

- **2026-10-03 — P8 part one: records AEAT accepts "with errors" now have a remedy.** This was
  the most defensible thing left to build, because it was an incoherence in working code rather
  than an absent feature — the submission sweep could produce a state the system could not then
  act on. AEAT's own documentation made it harder than it should have been: the XSD documents
  both `Subsanacion` and `RechazoPrevio` as "Clave del tipo de factura", a copy-paste error, so
  the semantics had to come from the operations table in the validations document instead.
  The case that is easy to get wrong, and now has a test of its own: a REJECTED CORRECTION takes
  `RechazoPrevio=S`, not `X`. Such a record is simultaneously a SUBSANACION and not-held-by-AEAT,
  so the obvious branch picks `X` — which would assert the ORIGINAL was never filed, when AEAT
  is holding it.
  Built by parameterising `recordInvoiceForTax` rather than writing a second builder, so the
  ordinary and corrective paths cannot drift about timezone, huella input or chaining. Verified
  the corrected document against AEAT's XSD, since `Subsanacion`/`RechazoPrevio` sit between
  `NombreRazonEmisor` and `TipoFactura` in the sequence and only the schema can confirm that.

- **2026-10-03 — P8 complete.** Anulación joins subsanación, and the useful thing to keep is
  how different they are. A *subsanación* re-sends a record under the same invoice identity with
  corrected content; an *anulación* says the invoice should never have existed and carries no
  amounts, no `Desglose` and no `TipoFactura` at all — it asserts nothing about money, only that
  a record is void. Its huella covers a different field set, which is why `huella.ts` has had
  `computeAnulacionHuella` since P5.
  **The line both modules now state in their headers:** a refund is neither of these. The sale
  happened, the record is true, and the remedy is a credit note — already working. Annulling a
  refunded sale would erase a real transaction, and it is exactly the mistake a future
  maintainer would make, because "cancel the invoice" sounds like what a refund is.
  Anulación's flags are two independent axes rather than a sequence of cases, so all four
  combinations are legal; a test covers each. Verified a submission carrying BOTH an alta and an
  anulación against AEAT's XSD, since they are a `<choice>` inside `RegistroFactura` and the
  anulación uses its own `…Anulada` element names.

- **2026-10-03 — P9a: the one claim that had to be reworded rather than implemented.** Every
  other promise on the live partner legal page was closed by building the thing. "Certified
  software (software de facturación homologado)" could not be, because there is no certification
  to obtain — AEAT homologates nothing, and compliance is the producer's own declaration. That
  line now says so and links to ours.
  The declaration is code rather than a static page for one reason: seven of its fields are the
  same facts that ride inside the `SistemaInformatico` block of every record we send. Written
  twice they would drift, and the drift would be a false statement about the software AEAT is
  receiving records from. Derived once, with a test.
  It renders as explicitly unsigned until `VERIFACTU_DECLARATION_SIGNED_ON`/`_AT` are set, which
  is deliberate — shipping a page that looks like a signed legal instrument but is not would
  repeat exactly the failure this phase was created to fix.

- **2026-10-03 — P9: the ops surface, and certificate expiry read from the certificate.**
  Everything the CLIs could already answer is now on one sudo-gated admin page, and
  deliberately read-only — correcting or voiding a record is a judgement, not a dashboard
  button.
  The part worth the dependency is expiry monitoring. An FNMT certificate lasts two years and
  **cannot be renewed after it expires**; a lapse fails during the TLS handshake, which looks
  like a network fault while records queue behind a backoff. A date typed into a setting would
  be wrong the day someone mistyped it, so `node-forge` now parses the configured PKCS#12 and
  the page counts down from what the certificate actually says. Declared as a direct dependency
  of `@repo/data` — it was present only via Expo in `apps/mobile`, the same trap as
  `@xmldom/xmldom`.
  Two things the work itself caught: a type error in `certificate.ts` that only the APPS'
  typecheck sees (further confirmation that the transitive typecheck is real coverage, and that
  the earlier claim about `packages/data` having none was wrong), and forge returning attribute
  values as binary strings — so our own producer name rendered as "Sunbnb EspaÃ±a SL" on the
  ops page. Both fixed; the second has a test, and its fixture needed openssl's `-utf8` to avoid
  double-encoding and making the fix appear not to work.

- **2026-10-03 — Records now say that we issue in the partner's name, which they did not.**
  Prompted by a question about whether we may invoice on the operator's behalf at all. The
  answer is yes and it is the model the regulation anticipates — invoices expedited *por
  delegación* under **art. 6 RRSIF** in relation to **art. 5 ROF**, where the obligations fall on
  *"el SIF del empresario que materialmente emite las facturas"*, i.e. us. The partner does not
  re-print the QR or re-send anything; they receive the invoices for their own bookkeeping.
  But checking it surfaced a defect. AEAT's developer FAQ: *"la constancia de que se ha
  producido emisión en nombre de tercero … debe estar correctamente informada en el XML del
  RF"*. The schema carries `EmitidaPorTerceroODestinatario` and a `Tercero` block, and I had
  omitted both when building the payload on the grounds that I could not establish which role we
  were in. We can: a **PARTNER** invoice is the venue's sale expedited by us (`T` + Tercero =
  Sunbnb España SL); a **PLATFORM** commission invoice is our own (neither field). It maps off
  `issuerType`, which every record already carried.
  Without it, an inspector could not distinguish a partner's own invoices from ones issued for
  them — which is precisely what the field exists for.
  **Still outstanding, and not code:** art. 5 ROF requires the obligado's **prior authorisation**
  for third-party issuance. The merchant agreement establishes the partner as Seller of Record
  but does not explicitly authorise Sunbnb to expedite invoices in their name. That clause is a
  separate act from P7a's submission grant and should be added.

- **2026-10-03 — P7a, built as two grants because it is two legal acts.** The obvious design is
  one "I agree to Veri\*factu" checkbox. That would misstate what was agreed: authorising
  someone to *issue invoices in your name* (art. 5 ROF) and authorising them to *file your
  records with the tax agency* (colaboración social) rest on different provisions, gate
  different things, and a partner can reasonably be in one state and not the other. Stored and
  checked separately.
  The gate sits on submission rather than generation, and skips rather than fails: records for
  an unauthorised partner stay `pending` with zero attempts, so nothing has to be undone when
  the grant arrives. Marking them `blocked` would have been the easy choice and would have
  stopped them retrying forever.
  Two things caught the work mid-flight and both were the system working: the partner app's
  coverage-contract meta-guard refused the new server action until it was registered with a
  justification, and the lifecycle test failed because it had asserted a partner's record would
  be submitted — which is exactly the behaviour this phase changes. The lifecycle test now
  demonstrates both halves: skipped without the grant, sent once it exists.
  Also fixed a bug while writing the action: it keyed the invoicing grant off the submission
  grant's presence, which would have silently skipped recording one of the two mandates.

- **2026-10-03 — P7a finished with the half that makes it usable.** Capturing a grant is only
  useful if somebody can see who has not given one. Admin `/verifactu` now lists every Spanish
  partner's state alongside **how many of their records the missing mandate is holding** — the
  difference between "this is absent" and "this is costing you 40 unfiled records". The `none`
  state is singled out, because it means we are issuing invoices in a partner's name with no
  mandate at all, which is a different problem from merely not being able to file yet.

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

- ☐ **D6 — How is a reverse-charge commission invoice declared in the `Desglose`?** Our
  PLATFORM commission invoice to an EU partner outside Spain carries 0 VAT under reverse
  charge, and the customer self-accounts. That is **not** a 0% taxed supply, so
  `CalificacionOperacion = S1` at `TipoImpositivo 0.00` would misstate it to AEAT. The
  candidates are `N2` (*no sujeta por reglas de localización*) or an `OperacionExenta` code.
  `buildDesglose` refuses these invoices until this is answered, so they show up unfiled in
  `verifactu:health` rather than being mis-declared — the right failure, but it does mean our
  own commission invoices to the Finnish partner are currently unfilable. One question for the
  asesor.

- ☐ **D7 — Does Veri\*factu apply in Canarias, Ceuta and Melilla, and how is a non-IVA rate
  declared?** Those territories levy IGIC and IPSI rather than IVA, so a `Desglose` built from
  `LEGAL_ES_VAT_RATES` does not describe them. `resolveTaxRegime` now returns
  `ES_INDIRECT_TAX_UNSUPPORTED` so nothing is filed, rather than producing a breakdown with the
  wrong tax in it. No partner is established there today. One question for the asesor.

- ☐ **D8 — Representante or Sello de Entidad?** FNMT recommends the **Sello de Entidad** for a
  cloud platform doing unattended high-volume submission, which is exactly what the sweep is.
  Arguments for it: issued to the ENTITY rather than to a named person, so it does not depend on
  one administrador's personal certificate and does not break when that person's *cargo*
  changes (the *administrador único* variant auto-revokes on a Registro Mercantil change —
  a sharp edge for a credential a server depends on all season); and it is purpose-built for
  automatic signing.
  Arguments against / unknowns: **(a)** the sede's company section sells only the three
  Representante variants, so a Sello appears to need a direct enquiry to FNMT rather than a
  self-service purchase; **(b)** whether a Sello is accepted as a *colaborador social* acting
  for third-party partners is **unverified** — AEAT's `4112` lists the acceptable roles but a
  seal identifies an entity, not a representative, and P7.2 depends on that working; **(c)** a
  Sello cannot be used interactively on the sede electrónica, so we would still want a
  Representante for human admin tasks.
  **Code impact if we choose Sello:** switch `client.ts` to `ENDPOINTS.productionSello` /
  `pruebasSello`. Those constants already exist; the comment in `registro-xml.ts` currently
  asserts we use the non-Sello hosts *because* we hold a Representante, and that assertion
  becomes wrong rather than merely stale.
  **Cheapest resolution:** ask FNMT (or the asesor) whether a Sello de Entidad can act under
  Convenio 017 colaboración social. If yes, Sello for the server and Representante for humans.
  If no, Representante for both.

- ☐ **D9 — The merchant agreement does not authorise third-party invoicing.** Art. 5 ROF
  (RD 1619/2012) permits a third party to expedite invoices for the obligado, but requires the
  obligado's **prior authorisation**. `apps/partner/app/legal/merchant-agreement` establishes
  the partner as Seller of Record and says nothing about Sunbnb issuing in their name — which is
  what the system actually does, and now declares in every record via
  `EmitidaPorTerceroODestinatario=T`. A clause is needed. Distinct from P7a: that grant covers
  *submitting* records to AEAT as a colaborador social, this one covers *issuing* the invoice.
  One for the asesor to word.

## Founder actions (not engineering) — the real critical path

P7 cannot go live however fast the code is built. Both items below have external lead time
and should start in parallel with the remaining phases. Sourced from AEAT's developer FAQ
(*Preguntas frecuentes de empresas de desarrollo*, **04-12-2025**, §16) and FNMT's own pages,
read 2026-09-30 — not from recall.

### A. The electronic certificate

**What it is.** One qualified electronic certificate belonging to **Sunbnb España SL** — not
one per partner. The FAQ requires "un certificado electrónico cualificado válido y admitido"
meeting eIDAS (Reg. UE 910/2014) "y, en su caso, contando con el otorgamiento de las
facultades necesarias" — the facultades being the colaboración social grant in B. It is used
as the TLS client certificate when submitting records, so it lives in the server environment,
never on a laptop.

**Which one.** A **Certificado de Representante de Persona Jurídica**. Admitted issuers are
those on the Ministry's list per **Orden HAP/800/2014**; FNMT is the default choice.

**Prices, confirmed from FNMT's own list (2026-10-02).** *Administrador único o solidario*
**29,04 €** inc. IVA · *Persona jurídica* **16,94 €** inc. IVA · *Entidad sin personalidad
jurídica* free. Card only. **There is a 7-day refund window** from accreditation, which
automatically revokes the certificate and requires that it has not been used — so a wrong
choice is recoverable if caught quickly (FNMT 91 740 68 48).

**How it is obtained (FNMT):** configure software → request online (returns a *Código de
Solicitud* by email) → accredit identity → download and pay.
- **€14 + IVA**, valid **2 years**, card payment at download, ~1 hour after accreditation.
- Sunbnb España SL's NIF is **B22435705** — a **B** prefix, which qualifies for FNMT's
  **online accreditation** (offered for prefixes A, B, C, D), so no in-person AEAT appointment
  is needed provided the legal representative is the one registered in the Registro Mercantil
  and holds a valid personal certificate. In-person is the fallback and needs *cita previa*.

**[2026-10-02] Which certificate TYPE is now an open decision — see D8.** FNMT publishes a
page specifically on this (*Certificados electrónicos válidos para el sistema VERI\*FACTU*,
read 2026-10-02) and it points away from the representative certificate for our shape of
system. Its recommendation, verbatim: *"Si tu empresa cuenta con varios empleados o genera un
alto volumen de facturas mediante un software de gestión o una plataforma en la nube, el
**Sello de Entidad** es la alternativa más eficiente y segura, ya que permite la firma
automática y desatendida de los registros de facturación."* It also states that seal
certificates *"no sirven para realizar los envíos/consultas por sede electrónica"* — Web
Service only, which is all we do — and that programs authenticating with a Sello **must use a
different endpoint**. That is the `www10`/`prewww10` pair already in `ENDPOINTS` as
`productionSello`/`pruebasSello`, currently marked unused.

**It can live on a server.** The key pair is generated locally during the request and FNMT
recommends making a *copia de seguridad* at download — i.e. it exports to `.p12`/`.pfx`, which
is what `AEAT_CERT_PFX_BASE64` needs. It is a software certificate, not card-bound.

**Custody note, unchanged from the plan:** we hold OUR certificate, never a partner's. Custody
of a partner's own qualified certificate is the ability to act as that company everywhere, not
just at AEAT.

### A1b. The endpoints and the certificate chain, verified against the live service (2026-10-03)

Probed AEAT's TLS endpoints directly — no certificate needed to learn this, and it checks
assumptions the code already bakes in:

- **Both endpoints are live and genuinely AEAT.** `prewww1.aeat.es` presents
  `CN=*.aeat.es, O=Agencia Estatal de Administración Tributaria`, Entrust-issued, `Verify
  return code: 0 (ok)`.
- **Both request a client certificate** during the handshake, confirming mTLS is the right
  model and that `client.ts`'s `https.Agent({ pfx, passphrase })` is the right shape.
- **`prewww1` accepts `CN=AC REPRESENTACIÓN G2` (FNMT-RCM)** — the exact CA that issues the
  *Certificado de Representante*, including the *administrador único* variant. So the
  certificate being obtained will be accepted at the TLS layer. 100 CAs accepted in total,
  including FNMT's `AC USUARIOS` (persona física).
- **`prewww10` — the `…Sello` endpoint — accepts `CN=AC ENTIDADES G2`**, which is FNMT's CA
  for *certificados de sello de entidad*, and only 56 CAs in total. This is empirical
  confirmation of the split the WSDL implied and that `ENDPOINTS.productionSello` /
  `pruebasSello` exist for: a Sello would be issued under a different CA AND submitted to a
  different host. Relevant to **D8**.
- `AC Representación` appears on BOTH lists, so a representante certificate is not locked out
  of the Sello host — but FNMT's own guidance says to use the matching endpoint, and that is
  what the code does.

What remains unverifiable without the certificate is narrow and specific: whether AEAT's
APPLICATION layer accepts our document content. Everything up to and including the TLS
handshake is now confirmed.

### A2. The authorization is enforced TECHNICALLY, not only legally — and it splits P7 in two

Checked against AEAT's live error list
(`https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties`,
read 2026-09-30). In the section *"códigos de error que provocan el rechazo del envío completo"*:

> `4112 = El titular del certificado debe ser Obligado Emisión, Colaborador Social, Apoderado o Sucesor.`
> `4110 = Error técnico al comprobar los apoderamientos.`

So the certificate alone is not enough to submit for a partner: without the Convenio the whole
**envío** is rejected, not one record. But note the first accepted role — **Obligado Emisión**.
That has two consequences worth building around:

1. **Our own PLATFORM commission invoices need no authorization at all.** Sunbnb España SL is
   the *obligado emisión* on them and holds the certificate, so they can be filed for real on
   the €14 certificate alone, before the Convenio is granted and before any partner signs
   anything. **P7 should therefore ship platform-issuer-first**: it exercises the whole
   transport — mTLS, the chain, the sweep, error handling, `Aceptado con errores` — against
   production AEAT with real documents, while partner submission stays gated behind P7a.
2. **Never mix issuers in one message.** The `Cabecera` carries a single `ObligadoEmision`, so
   a submission is structurally single-issuer anyway — but 4112 rejecting the *entire* envío
   makes it worse than a wasted call if it were ever batched. This independently confirms the
   per-NIF sweep and the stop-at-first-failure rule.

### B. The colaboración social agreement (Convenio)

Registration is separate from and additional to the certificate, and AEAT is explicit that
*"ningún colaborador social realice envíos sin estar previamente autorizado"*.

**Convenio code: 017.** The FAQ states that for VERIFACTU one may work with 001, 002 (for
*intermediarios*) and **017 (both intermediarios and software companies)** — Sunbnb is a
software company, so 017.

**Where to apply:** the AEAT Delegación for the company's fiscal domicile, **or** by email to
`comunicacion.sepri@correo.aeat.es`.

**Documentation AEAT asks for**, verbatim from §16 Q2 — each item as a PDF:
- a formal written request, signed by someone with representation, for an *acuerdo de
  colaboración social en la aplicación de los tributos* under **art. 92 Ley 58/2003**
- full name and NIF of the entity
- the article of the *estatutos* referring to the **objeto social**
- name and NIF of whoever signs for the entity — if *representante por estatutos*, a
  certificate from the company secretary evidencing the appointment; otherwise an
  *escritura de apoderamiento suficiente*
- name and NIF of a contact person, a contact phone, the entity's domicile, an email address

**After approval,** the per-partner grants are managed through Sede Electrónica →
*Gestiones de colaboración social*. AEAT blesses collecting each partner's grant by web form
with electronic signature, which is what P7a builds.

### C. The declaración responsable (D4)

Unchanged: Sunbnb self-certifies as *productor de software*; AEAT does not homologate. The
declaration is not filed but must be visible inside the software in every version (P9a), and
it is the only thing that makes the live legal page's "certified software" line true.


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
