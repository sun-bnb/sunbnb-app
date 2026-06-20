---
description: Query & inspect the Sunbnb DB across local/test/production for design, debugging, and data fixes — schema-aware, env-tiered, read-only MCP. Complements /migrate (schema changes).
argument-hint: "[local | test | production]"
---

# /db — database query & inspection capability

Shared capability for **reading and reasoning about data** in any environment — checking
local rows while building a feature, diagnosing an issue in test/production, or scoping a
data fix. Any agent (a generalist, a specialist, or the main session) can invoke it. This is
the **data** counterpart to `/migrate`, which owns schema/DDL — invoke `/migrate` for
anything that *changes the schema*, `/db` for anything that *reads or fixes the rows*.

**Argument** (`$ARGUMENTS`, optional) — the environment: `local` · `test` · `production`.
If omitted, default to `local`.

## The one safety fact that frees you

The three Postgres MCP servers (`mcp__postgres-{local,test,production}__query`) wrap **every
query in a `READ ONLY` transaction** (`@modelcontextprotocol/server-postgres` issues
`BEGIN TRANSACTION READ ONLY`). Consequences:

- **You cannot write through these tools — in any environment, including production.** A
  `SELECT` against prod is safe; an `INSERT`/`UPDATE`/`DELETE` errors out, it does not mutate.
- So **read freely, even against production** — but every prod row is real customer/financial
  data (PII, payments, invoices). Don't paste raw PII (emails, names, payment refs) into
  reports or `kb:` markers — aggregate, count, or redact.
- **Fixing data is a separate, deliberate path** (see *Fixing data* below). It never happens
  by accident through a query tool — which is exactly the safety property we want.

## Environment topology (mirrors `.claude/rules/migrations.md`)

| `$ARGUMENTS` | MCP tool | Points at | Caution |
|---|---|---|---|
| `local` | `mcp__postgres-local__query` | local Docker Postgres (`POSTGRES_URL`) | your dev data — free-for-all |
| `test` | `mcp__postgres-test__query` | **shared TEST DB** — serves both `main`/preview **and** test.sunbnb.app | shared infra others rely on |
| `production` | `mcp__postgres-production__query` | PROD DB (sunbnb.app, `POSTGRES_URL_PRODUCTION`) | real customers; read-only; redact PII |

`main`/preview and `test` share **one** database; production is isolated. (`sunbnb_test`, the
integration-test DB, is a *fourth* local DB not exposed here — the test suites own and reset it.)

## Orient before you query — pull the schema, don't guess

The schema is the source of truth, and raw SQL needs the **exact** mapped names (see
landmines). Before composing non-trivial queries:

1. **Schema:** `packages/data/prisma/schema.prisma` — models, `@map`/`@@map` names, relations,
   indexes. (`mcp__prisma__*` tools and Postgres `\d`-style introspection also work.)
2. **Status vocabulary:** `packages/data/src/reservation-status.ts` — status fields are plain
   strings; use these **exact** values, never invent or guess casing.
3. **Domain context:** the relevant `.claude/wiki/entities/*` page (reservation, order,
   invoice, settlement, service-fee, table-reservation) and `packages/data/CLAUDE.md` for the
   model / payment / invoice layer.

## Schema landmines for raw SQL (Prisma naming is NOT uniform)

- **Table names are PascalCase** — `"Reservation"`, `"Invoice"`, `"Order"`, `"InventoryItem"`,
  `"Settlement"`, `"RentalBooking"`. **Double-quote them**; an unquoted identifier folds to
  lowercase and matches nothing. **Exceptions** (`@@map`'d to snake_case): the restaurant
  family — `restaurant`, `restaurant_table`, `table_reservation`, `table_combination`,
  `menu_item`, `restaurant_hours`, `restaurant_shift`, `table_waitlist_entry` — plus
  `password_reset_token`, `layout_element`, `feature_flag`, `impersonation_log`.
- **Column names are MIXED.** Most foreign keys / multi-word fields are `@map`'d to snake_case
  (`site_id`, `user_id`, `anon_id`, `operational_status`, `payment_ref`, `payment_amount`,
  `total_charge`, `issuer_type`, `reservation_id`) — but `createdAt` / `updatedAt` keep
  camelCase and **must be double-quoted** (`"createdAt"`), and short fields are bare lowercase
  (`status`, `type`, `from`, `to`, `id`, `price`, `tax`). **Always check the field's `@map` in
  `schema.prisma`** before naming a column.
- **Statuses are strings, not enums** — `status = 'complete'`, `operational_status =
  'checked_in'`. Wrong casing or an invented value silently matches zero rows.
- **Money is `Float` and VAT-inclusive.** Don't sum invoices expecting them to reconcile to the
  consumer payment: the **PARTNER** invoice (gross sale) and the **PLATFORM** invoice (B2B
  commission billed to the partner) do *not* sum to what the consumer paid — agent model. See
  `.claude/rules/payments.md`.
- **Ownership is `user_id` OR `anon_id`.** Anonymous POS/QR rows have `anon_id` set and a
  placeholder/owner `user_id`; when hunting "a person's" reservations/orders/rentals, consider
  both columns.
- **PostGIS:** `Site` carries a `geometry` column with a GiST index — filter distance with
  `ST_DistanceSphere(geom, ST_MakePoint(lng, lat))`, never lat/lng arithmetic.

## Query templates (verify names against `schema.prisma` first)

Stuck / mid-payment reservations (a `/api/reconcile` candidate):
```sql
SELECT id, status, operational_status, "createdAt", payment_ref, payment_amount, site_id
FROM "Reservation"
WHERE status IN ('pending', 'processing')
  AND "createdAt" < now() - interval '30 minutes'
ORDER BY "createdAt" DESC;
```

A specific payment, end to end (reservation + both invoices):
```sql
SELECT r.id AS reservation_id, r.status, r.payment_ref,
       i.issuer_type, i.invoice_number, i.total_amount, i.processing_fee, i.settlement_id
FROM "Reservation" r
LEFT JOIN "Invoice" i ON i.reservation_id = r.id
WHERE r.payment_ref = 'tr_xxxxxxxx'           -- Mollie tr_… or pi_demo_… ref
ORDER BY i.issuer_type;                        -- expect one PARTNER + one PLATFORM
```

Invoice hash-chain integrity for one issuer (each row's `previous_hash` = prior `hash`):
```sql
SELECT invoice_number, issuer_type, "createdAt", hash, previous_hash
FROM "Invoice"
WHERE issuer_type = 'PARTNER'
ORDER BY invoice_number;
```

Double-booking / availability conflict on one inventory item:
```sql
SELECT r.id, r.status, r."from", r."to"
FROM "Reservation" r
JOIN "_InventoryItemToReservation" j ON j."B" = r.id
WHERE j."A" = '<inventoryItemId>'
  AND r.status NOT IN ('canceled', 'payment_failed', 'refunded')
  AND r."from" < '<rangeEnd>' AND r."to" > '<rangeStart>';
```

Daily paid revenue for a site (gross, partner-booked):
```sql
SELECT date_trunc('day', "createdAt") AS day, count(*), sum(payment_amount)
FROM "Reservation"
WHERE site_id = '<siteId>' AND status IN ('complete', 'paid_in_cash')
GROUP BY 1 ORDER BY 1 DESC;
```

Settlement coverage for a period (does a draft already exist?):
```sql
SELECT id, period_start, period_end, gross_revenue, commission, net_payout, currency
FROM "Settlement"
WHERE account_id = '<accountId>' AND site_id = '<siteId>'
ORDER BY period_start DESC;
```

## Fixing data (test / production) — never raw, never improvised

MCP can't write, and that's the right default. When a genuine data fix is warranted:

1. **Diagnose first** with read-only queries here. Write up the exact rows and the intended
   change before touching anything.
2. **Prefer the model layer over raw SQL.** A fix routed through a `@repo/data` function or a
   server action keeps the invariants intact — invoice idempotency + hash chain, settlement
   aggregation, VAT / fee cascade, status-transition rules. A bare `UPDATE` can silently break
   the invoice hash chain or orphan a settlement roll-up.
3. **Name the blast radius** before any write: which invoices, settlements, or aggregates
   depend on this row? Cross-reference `.claude/rules/payments.md` and `data-access.md`.
4. **Execution path (all human-gated, none through MCP):** Prisma Studio
   (`cd packages/data && source .env.local && npx prisma studio`) for a one-off field on
   local/test; a written, reviewed server-side one-shot for anything structural; schema
   changes go through `/migrate`. For **production**, *stop and get explicit user sign-off* —
   and prefer a fix-forward (a corrective code path / re-run of the owning action) over
   hand-editing prod rows.
5. **Production writes are the user's call. Propose, don't perform** (see
   `.claude/rules/deploys.md` — DB mutations are as consequential as a deploy).

## While you work

Follow `.claude/agent-protocol.md` — emit `kb:` markers for data-shape gotchas (a surprising
status value, a reconciliation quirk, a mapping trap). If you compose a query worth reusing or
learn a durable truth about the data model, fold it into the planned `ops/database` wiki page
via `/wiki ingest`.
