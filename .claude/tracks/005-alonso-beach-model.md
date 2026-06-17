---
id: 005-alonso-beach-model
title: Alonso Beach App Model
status: done
created: 2026-06-17
updated: 2026-06-17
worktree: null
---

## Goal

**Build a detailed, durable model of the "Alonso Beach" app** — a real, operating
beach-business management app (sunbed/*hamaca* rental, in Spanish) deployed at
`https://alonso-beach-app2-production.up.railway.app/`. It is a standalone Vite/React SPA
with a socket.io backend; it is **not** part of this repo. The source of truth we have is its
**production client JS bundle** (saved as an artifact — see Links).

**Why it matters.** Alonso Beach is a working, in-the-field product solving the exact on-site
beach-operations problem Sunbnb's partner "manage" surface targets — run by people actually
renting out sunbeds for money. Reverse-engineering *how it models the domain and the daily
operational flow* gives us a **ground-truth reference** to pressure-test and guide Sunbnb's own
design decisions (the manage page, walk-in rentals, cash-close/accounting, employee attribution,
sunbed state machine). This track is **research/modelling, not a build** — no Alonso code is
copied; we extract concepts and patterns.

**End state.** A complete functional model under `.claude/alonso/model/` covering: the sunbed
state machine (done as a first pass), reservations, rentals & rental history, the cash-close
(*Cierre de Caja*) / accounting flow, employee attribution, reporting, password/access tiers,
the day-reset lifecycle, and the backend socket sync protocol — each with a short
"implications for Sunbnb" note. Plus a synthesis doc mapping Alonso's concepts onto Sunbnb's
existing model and flagging where they diverge.

**Non-goals.** Not reproducing Alonso's UI; not a security probe of their backend; not copying
code. We only read the publicly-served bundle we already fetched.

## Resume here

- **Status: DONE.** All seven phases complete; the full functional model of Alonso Beach lives in
  `.claude/alonso/model/` (6 subsystem docs + `synthesis-sunbnb.md`, the payload). Nothing further
  required to satisfy the goal.
- **If reopening / follow-on work, the obvious next actions:**
  - **Act on the synthesis.** When a partner manage-page floor-ops effort starts, pull the
    prioritized lessons from `model/synthesis-sunbnb.md` (esp. the bundle: comp `gratis` state →
    floor-staff attribution → daily per-employee till → lightweight same-day hold). That would be a
    **new build track**, not this one.
  - **Wiki promotion (open decision below).** Propose a short `.claude/wiki/` pointer + lesson list
    *when* such an effort begins — promote on use, not speculatively. Decide with the user before
    `/wiki ingest`.
  - **Live-runtime validation.** The whole model is bundle-derived (static). If a browser-driving
    tool becomes available, a logged-in walkthrough (worker pw `112`) would confirm dynamic behavior.
  - **Re-fetch on redeploy.** Build hashes (`index-0i_bs0Iv.js` / `index-ltPs3dSD.css`) fingerprint
    this build; if Alonso redeploys, re-fetch artifacts and diff — the model may drift.
- **Context:** all docs under `.claude/alonso/` (`README.md` = layout/method, `metadata.md` =
  deployment/protocol/glossary, `model/*.md` = the model, `artifacts/` = the saved source).
- **Blocked by:** nothing. (Cannot log in live — no headless browser — so the model is built
  from the bundle, not runtime observation. If a browser-driving tool becomes available, a live
  pass would confirm dynamic behavior. Worker password observed by user: `112`.)

## Roadmap

- ✅ **P0 — Scaffold.** Create `.claude/alonso/` (README, metadata, artifacts/, model/), save the
  prod bundle + index.html as artifacts, register the track.
- ✅ **P1 — Sunbed state machine.** 5 states (`libre`/`reservada`/`alquilada`/`gratis`/
  `desactivada`), transitions, guards, income side-effects → `model/sunbed-states.md`.
- ✅ **P2 — Reservations & rentals.** Reservation records, rental-history records, quick-reservation
  auto-create, Devolución, Cambio de Lugar (relocate) → `model/reservations-and-rentals.md`.
- ✅ **P3 — Cash-close & accounting.** `dailyStats`/`historicalStats`, flat €8 income model,
  the **two closes** (per-employee shift-close via `shiftClosedAt` vs. final day-close), day-reset
  (`resetDay`) lifecycle + durable-vs-ephemeral split → `model/accounting-and-dayclose.md`.
  (TXT export lives in Reportes → covered in P5, not here.)
- ✅ **P4 — Employees & access tiers.** Employee = a name string (no accounts), captured at rent
  via `localStorage`, stamped on `rentalHistory`; **two effective tiers** (worker/admin) via shared
  plaintext passwords + session-sticky `unlockedLevels`; nav gate `$`/elevation `te`/manager `G`;
  **`closePassword` is dead code** (never checked) → `model/employees-and-access.md`.
- ✅ **P5 — Reporting.** *Reportes Avanzados* (`Fie`, admin): reads **only** `historicalStats`;
  sliding-window filter (diario/semanal/mensual/anual), Total Ingresos / Hamacas / *Mejor Día*,
  Recharts trend chart, full-history TXT export. No per-employee/occupancy/comp reporting →
  `model/reporting.md`.
- ✅ **P6 — Backend sync protocol.** socket.io contract (same-origin, unauthenticated), optimistic
  full-object-replace setters vs. server-authoritative passwords, `initialState`/`dayReset`
  rehydrate, **single global tenant state** (no site/user scoping), last-write-wins race,
  client-trusted money + plaintext passwords pushed to all → `model/sync-protocol.md`.
- ✅ **P7 — Synthesis for Sunbnb.** Concept-map (Alonso ↔ Sunbnb ↔ gap/convergence/divergence),
  8 prioritized lessons-to-act-on, 6 anti-patterns-not-to-import, meta-insight (floor-ops layer is
  Sunbnb's gap), wiki-promotion open decision → `model/synthesis-sunbnb.md`. **Track complete.**

## Log

- **2026-06-17** — Track created. Origin: user asked Claude to log into the live app (worker
  pw `112`); WebFetch only saw the empty SPA shell, so the prod JS bundle was fetched and
  reverse-engineered instead. First pass already extracted the 5-state sunbed machine and the
  socket event list. Scaffolded `.claude/alonso/` and saved the bundle as the source-of-truth
  artifact. P0 + P1 complete.
- **2026-06-17** — P2 complete → `model/reservations-and-rentals.md`. Extracted both record
  collections (`reservations[]`, `rentalHistory[]`) and their handlers from the bundle: `Yie`
  *Reservas* view (`p`=create marks libre→reservada, `m`=delete frees only-dangling reservada
  beds via recomputed reserved-set), quick-reservation auto-create (single `br` + bulk `ka`
  "Reserva Rápida Múltiple"), Devolución `jt` (−€8, closes history row), Cambio de Lugar `ul`
  (positional 1:1 transfer, rewrites the open history row's bed, no income change). **Key finding:
  Alonso has no equipment-rental catalog** — a "rental" = a sunbed entering `alquilada`; reservations
  are same-day, payment-free holds. Logged Sunbnb implications (lightweight hold primitive,
  relocate-preserving-identity, per-bed live ledger vs. invoices). Also completed the artifact
  sweep earlier: saved CSS + brand logo, confirmed no source maps, pinned socket = same-origin.
- **2026-06-17** — P3 complete → `model/accounting-and-dayclose.md`. Accounting substrate =
  `dailyStats` + `historicalStats` (per-date) + `rentalHistory`; **flat €8 (`Wu`), no VAT/fees/
  invoices**. Income archived as-you-go via `_t` (and subtracted by `jt`). **Two distinct closes
  decoded:** (1) per-employee shift-close `Xie.m(emp)` stamps `shiftClosedAt`(+`closedAt`),
  partitions `currentShift`/`history`, touches neither beds nor day; (2) final day-close `vM` →
  `Ce` = `resetDay`: regenerates the fixed **180-bed grid** (`$ie`, 5×18×2 pairs), zeroes
  `dailyStats`, **clears `rentalHistory`** (so per-employee detail is lost), **keeps**
  `reservations`+`historicalStats`, re-applies `reservada`/`desactivada`. Load-bearing semantic:
  reset **archives without subtracting** (vs. Devolución subtracts). Sunbnb implications: no
  daily/per-employee cash-reconciliation surface exists; attribution is ephemeral; durable-vs-
  ephemeral floor-state split.
- **2026-06-17** — P4 complete → `model/employees-and-access.md`. **Employee = a free-text name,
  not an account** — captured at rent (`Jie` modal / single-bed editor, prefilled from
  `localStorage["alonso-beach-employee"]`), stamped on `rentalHistory[].employeeName`, wiped on
  day-reset (no cross-day staff history). **Access = two effective tiers** (worker `appPassword`,
  admin `adminPassword`) via shared **plaintext** passwords; `unlockedLevels` session-sticky, init
  `[]`, admin works everywhere. Decoded `Kie.$` nav gate, `Kie.te` elevation, `eae` worker login,
  `Kie.G` password manager. **Finding: `closePassword` is vestigial/dead** — stored, synced, kept
  equal to admin pw, but never compared anywhere. **Corrected** P3 doc + `metadata.md` which had
  wrongly said it gates the close. Sunbnb implications: no floor staff-identity (manage page is
  token-gated, no employee); avoid shared-plaintext tiers; two-tier split validates `'all'`/
  `'manage_site'`; `localStorage` "current worker" UX win; dead-tier cautionary tale.
- **2026-06-17** — P5 complete → `model/reporting.md`. *Reportes Avanzados* (`Fie`, admin-gated
  `reportes`) reads **only** `historicalStats[]` — no `rentalHistory`/`reservations`. Sliding-window
  filter (diario=today / semanal=7d default / mensual=30d / anual=365d — rolling, **not** calendar).
  Metrics: Total Ingresos, Hamacas Alquiladas, *Mejor Día* (max ingresos). **Recharts** composed
  trend chart (*Tendencia de Ingresos*, dual-axis) — added Recharts to metadata stack. TXT export
  (`h`) = fixed-width "HISTORIAL DETALLADO" Blob download, **exports full history ignoring the
  period filter** (quirk); TXT is the only format. Confirmed gaps: **no per-employee, per-bed,
  per-hour, occupancy%, or comp(`gratis`) reporting** — collected-but-discarded data. Sunbnb
  implications: thin-but-core (trend+best-day+export); persist+report attribution Alonso throws
  away; surface comps/occupancy; offer rolling AND calendar lenses; add a plain CSV/TXT export.
- **2026-06-17** — P6 complete → `model/sync-protocol.md`. socket.io, `$e=dd()` **same-origin,
  unauthenticated**, created pre-login. Two sync patterns: **optimistic full-object-replace** for
  the 5 operational collections (`ke`/`oe`/`ue`/`Ee`/`ne` = setState + emit `update*`) vs.
  **server-authoritative** passwords (emit → wait for `*PasswordUpdated` echo). `initialState`
  (incl. **plaintext passwords**) / `dayReset` are full rehydrates; one `useEffect` wires+cleans
  all listeners; a `connected` boolean drives a live indicator. **Implied server = one global
  shared state object, no `siteId`/`userId` — single-tenant** (multi-venue = multi-deploy).
  Failure modes: **last-write-wins whole-collection clobber** (double-book race), **client-trusted
  money** (`_t` €8 client-side), **unauth socket pushes passwords to any client**. Sunbnb = the
  architectural inverse (server-authoritative, idempotent/transactional, DB prices, per-request
  auth); steal the realtime-push UX (vs. RTK polling) but never the trust model.
- **2026-06-17** — P7 complete → `model/synthesis-sunbnb.md`. **Track done.** Cross-cut all six
  model docs into the payload: a 13-row concept-map (Alonso ↔ Sunbnb ↔ relationship), 8 prioritized
  lessons-to-act-on (top bundle: comp `gratis` state → floor-staff attribution → daily per-employee
  till → lightweight same-day hold — the daily-ops layer Sunbnb most lacks), 6 anti-patterns-not-to-
  import (client-trusted money, unauth socket + plaintext secrets, shared plaintext tiers, last-
  write-wins, single-tenant global state, security-theater tier). Meta-insight: Alonso = single-
  tenant client-trusting realtime *floor app*; Sunbnb = multi-tenant server-authoritative
  *marketplace SaaS* — mine the floor-ops ergonomics, never the trust model; aligns with
  [[track:002-table-reservations]] leisure-venue-OS ambition. Wiki promotion left as open
  decision (promote on use, not speculatively).

## Open decisions

- **Live-runtime pass?** Whole model is bundle-derived (static). A logged-in walkthrough would
  validate dynamic behavior but needs a browser-driving tool we don't currently have. Deferred,
  not blocking.
- **Where do lessons land?** P7 synthesis lives in `.claude/alonso/`. Decide later whether
  durable, verified design lessons get promoted into `.claude/wiki/` (e.g. a subsystem note on
  on-site operations) vs. staying reference-only in the alonso dir.

## Links

- Artifact (source of truth): `.claude/alonso/artifacts/index.prod.js`
- Model dir: `.claude/alonso/model/`
- [[track:002-table-reservations]] — sibling "leisure-venue OS" ambition; Alonso is a real-world
  reference point for that vision's on-site-operations half.
- Sunbnb counterpart surface: partner manage page (`apps/partner/app/sites/[id]/manage/`).
