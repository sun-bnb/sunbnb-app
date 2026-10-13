---
type: entity
slug: settlement
status: stale
sources:
  - packages/data/prisma/schema.prisma#model-Settlement
related:
  - entity:invoice
  - subsystem:payments
last_verified: 2026-10-13
---

# Settlement — RETIRED

**Retired 2026-10-13 ([[track:032]]); delete this page after 2026-11-12.** The admin settlement
feature (preview → generate → close → approve → mark paid, `@repo/data/settlement`,
`apps/admin/app/settlements`) was removed. It modelled the platform collecting consumer money
and paying partners out, which ended with direct charges (Mollie for Platforms, Stripe Connect,
Viva): the partner's own provider account is paid, and the commission is taken at charge time.
Production never created a settlement.

What remains: the `Settlement` table and `Invoice.settlementBatchId` (unused, dropped by a later
contract migration) and the admin `deleteUser` cleanup of legacy rows. Partner money reporting is
the partner accounting page and invoices ([[entity:invoice]], [[subsystem:payments]]).
Do not confuse with till **cash settlements** (`TillEntry`, [[subsystem:employee-till]]) or the
payment provider's own payout settlements (`Invoice.settlementId`).

The full former page is in git history (`git log -- .claude/wiki/entitys/settlement.md` before this commit).
