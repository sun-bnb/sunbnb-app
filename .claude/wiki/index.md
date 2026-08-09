# Wiki Index

Catalog of every page in `.claude/wiki/`. Scan this first when looking for information. The slug after each title matches the filename; cross-references elsewhere use `[[type:slug]]`.

Status legend: **stable** verified · **draft** new, unverified · **stub** placeholder only · **stale** known out of date

---

## Schema (root)

- [README](README.md) — what the wiki is, conventions, how to use it
- [Index](index.md) — this file
- [Log](log.md) — append-only history of wiki changes

## Workflows — how the LLM uses & maintains the wiki

Invokable via `/wiki <op>` (see `.claude/commands/wiki.md`).

**Maintenance loop** (lint → prune → ingest, with periodic review):

- [`workflow:ingest`](workflows/ingest.md) — **stable** — decision-led; fold new info into the wiki (or decide it's not wiki-worthy)
- [`workflow:lint`](workflows/lint.md) — **stable** — read-only health check; classifies findings by severity
- [`workflow:prune`](workflows/prune.md) — **stable** — actively remove dead / low-value content
- [`workflow:review`](workflows/review.md) — **stable** — periodic strategic re-pass: are pages still earning their keep?

**Per-task use:**

- [`workflow:query`](workflows/query.md) — **stable** — answer a question from the wiki
- [`workflow:feature-design`](workflows/feature-design.md) — **stable** — design a feature using the wiki for context
- [`workflow:debugging`](workflows/debugging.md) — **stable** — diagnose a problem using the wiki for orientation
- [`workflow:implementation`](workflows/implementation.md) — **stable** — implement a designed feature

## Entities — core domain concepts

- [`entity:reservation`](entities/reservation.md) — **stable** — sunbed booking, status lifecycle, ownership
- [`entity:order`](entities/order.md) — **stable** — F&B order placed during a reservation
- [`entity:invoice`](entities/invoice.md) — **stable** — generated post-payment, two-invoice rule, hash chain
- [`entity:service-fee`](entities/service-fee.md) — **stable** — three-tier cascade, fixed vs percentage
- [`entity:settlement`](entities/settlement.md) — **stable** — monthly partner payout aggregation, DRAFT→PAID
- [`entity:restaurant`](entities/restaurant.md) — **stable** — PartnerAccount-owned venue, optional Site soft-link, booking config, ownership
- [`entity:table-reservation`](entities/table-reservation.md) — **stable** — table booking, dual-status machine, free today, `Table` model

## Flows — end-to-end journeys

- [`flow:reservation-payment`](flows/reservation-payment.md) — **stable** — booking → Mollie/Demo → invoice → confirmation email
- [`flow:order-payment`](flows/order-payment.md) — **stable** — F&B order placement → payment → invoice (consumer pays listed price; commission parallel)
- [`flow:rental-booking`](flows/rental-booking.md) — **stable** — equipment rental: availability check → booking → payment → pickup/return
- [`flow:walk-in`](flows/walk-in.md) — **stable** — partner manage page: occupancy lifecycle (walk-in/hold/comp/block creators vs transitions), `[from,to]` + `until`, two-clock GC, pool seats, QR walk-in payment collection (Mollie + anonId capability + receipt)
- [`flow:settlement-cycle`](flows/settlement-cycle.md) — **stable** — admin app: generate → close → approve → mark paid
- [`flow:table-booking`](flows/table-booking.md) — **stable** — availability → slot → guest form → confirm → email; cancel; staff lifecycle (no payment)

## Subsystems — cross-cutting modules

- [`subsystem:auth`](subsystems/auth.md) — **stable** — NextAuth setup per app, session lifetime, anonId, ownership checks, sudo
- [`subsystem:payments`](subsystems/payments.md) — **stable** — consumer Mollie + Demo (Stripe = subscriptions only), webhooks, reconciliation, refunds
- [`subsystem:table-reservations`](subsystems/table-reservations.md) — **stable** — restaurant product: core/ui packages, availability engine, app wiring, extraction posture
- [`subsystem:schematic-editor`](subsystems/schematic-editor.md) — **draft** — shared grid geometry + editor chrome behind sunbed inventory & restaurant tables
- [`subsystem:design-system`](subsystems/design-system.md) — **draft** — UI design language: `accent` token, component classes, identity header, `Toggle`; canonical conventions in `.claude/rules/ui.md`. Prime with `/ui`
- [`subsystem:employee-till`](subsystems/employee-till.md) — **draft** — floor-staff roster (`/account/staff`) + automatic per-worker attribution + per-worker cash till/close (`TillSheet`) + manager monthly breakdown (accounting); `@repo/data/till`. Track 008

---

## Planned (not yet written)

These are concepts that warrant pages but have not been synthesized. Create them when (a) the LLM is asked the same question twice and the answer requires reading the same code, or (b) an `ingest` pass identifies a missing concept. **Do not create empty stubs** — only add a page when there is something to write.

**Entities:** `site`, `inventory-item`, `partner-account`, `rental-item`, `rental-booking`, `user`, `product`, `subscription`

**Flows:** `pos-anonymous`, `password-reset`, `refund`, `reservation-cancellation`, `parcel-edit`, `subscription-checkout`

**Subsystems:** `email`, `cron`, `i18n`, `image-upload`, `postgis`, `state-management`, `testing`

**Apps:** `apps/user`, `apps/partner`, `apps/admin` (deep-dive companions to the per-app `CLAUDE.md`)

**Ops:** `env-vars`, `local-setup`, `database`, `deployment`, `known-quirks`

---

## Pointers to canonical sources outside the wiki

The wiki points to these; it does not duplicate them.

| What | Where |
|---|---|
| Architectural overview (system-wide) | `CLAUDE.md`, `PROJECT_CONTEXT.md` |
| Per-app architecture | `apps/{user,partner,admin}/CLAUDE.md` |
| Data package conventions | `packages/data/CLAUDE.md` |
| Declarative rules | `.claude/rules/{auth,data-access,payments}.md` |
| Per-agent past learnings | `.claude/knowledge/<agent>.md` |
| Agent profiles | `.claude/agents/<agent>.md` |
| Slash commands | `.claude/commands/<command>.md` |
| Architecture deep-dive (human) | `ARCHITECTURE.md` (root, when present) |
| Security model (human) | `SECURITY.md` (root, when present) |
| Outstanding TODOs | `packages/docs/TODO.md` |
| Prisma schema (canonical data model) | `packages/data/prisma/schema.prisma` |
| Status constants (canonical statuses) | `packages/data/src/reservation-status.ts` |
| Payment service (canonical billing logic) | `packages/data/src/payment.ts` |
