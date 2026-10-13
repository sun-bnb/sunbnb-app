---
type: workflow
slug: debugging
status: stable
sources:
  - .claude/wiki/README.md
  - packages/data/src/payment-refs.ts
  - packages/data/src/reservation-machine.ts
  - apps/user/app/api/reconcile/route.ts
  - .claude/commands/db.md
related:
  - subsystem:payments
  - subsystem:auth
  - subsystem:reservation-state-machine
last_verified: 2026-10-13
---

# Workflow: Debugging

Procedure for diagnosing a reported problem. The wiki lets you orient on the relevant flow or subsystem in seconds instead of grepping.

## Procedure

### 1. Restate the symptom precisely

Strip interpretation; capture what was observed:
- What did they do, expect, and see?
- Which app (user, partner, admin, mobile)? Which environment (local, preview/test — they share the TEST DB — or production)?
- Reproducible? On which inputs? Which payment provider was the venue on?

### 2. Map the symptom to a flow

| Symptom hint | Start at |
|---|---|
| Booking didn't create / payment screen errored | `[[flow:reservation-payment]]` |
| Order placed but no invoice | `[[flow:order-payment]]` → **Side effects** |
| Equipment rental shows wrong availability | `[[flow:rental-booking]]` |
| Sunbed shown free when it isn't (or vice versa) | `[[subsystem:reservation-state-machine]]` + `[[entity:reservation]]` |
| Walk-in won't check in / collect fails | `[[flow:walk-in]]` |
| Table or dine-in tab misbehaves | `[[flow:table-booking]]` |
| Partner payout / revenue looks wrong | `[[entity:invoice]]` + `[[entity:service-fee]]` + `[[subsystem:payments]]` (payouts come from the partner's own provider; there is no platform payout) |
| Login / "you don't own this" | `[[subsystem:auth]]` |
| Webhook didn't fire / payment stuck | `[[subsystem:payments]]` → webhooks + reconciliation |

Not listed? `/context-loop:recall "<symptom>"` — past sessions often hold the same incident (episodic tier: a lead, verify it).

### 3. Read the flow / subsystem page

Look at **Sequence** (the step where it could fail), **Side effects** (what should have happened but didn't, or vice versa), **Failure modes** (known pattern with a documented recovery) and **Common pitfalls**.

### 4. Form hypotheses, ranked — cheap to disprove first

1. **Auth/ownership** — wrong user, missing `anonId`, missing sudo. Check the `requireSiteOwner()` / `verifyOwnership()` call on the path.
2. **State-machine mismatch** — a transition that didn't fire or was rejected. Compare `status` / per-day `operationalStatus` with the constants in `packages/data/src/reservation-status.ts` and the `TRANSITIONS` table in `packages/data/src/reservation-machine.ts`.
3. **Idempotency / double-write** — invoice created twice, or not created because a partial run left inconsistent state.
4. **Provider state diverged** — the rail is identified by `paymentRef` prefix (`providerFromRef` in `packages/data/src/payment-refs.ts`); check the payment in that provider's dashboard (Mollie, Stripe connected account, Viva).
5. **Webhook missed** — reconciliation should catch it; if it doesn't, that's a second bug.
6. **Env var missing** — e.g. `RECONCILIATION_SECRET` / `CRON_SECRET`, `MOLLIE_*`, `STRIPE_CONNECT_*`, `VIVA_*` (root `CLAUDE.md` § Key Environment Variables).
7. **Race** — availability check and create not in one operation.
8. **Venue-day boundary** — dates computed in UTC instead of the venue's civil day (`[[subsystem:venue-timezone]]`).

### 5. Verify against code and data

For each hypothesis, open the file the flow page cites and trace the path; grep for status constants, call sites, env var references. For DB state, use `/db` (schema-aware, read-only, local/test/production) rather than guessing.

### 6. Confirm root cause

Don't propose a fix until you can state: the exact line(s) where it originates, the precise condition, why no existing safeguard caught it, and the correct behaviour (with a citation — wiki page or rule file).

### 7. Fix or report

Small and well understood: fix it and add a regression test that fails without the fix. Big: write up the diagnosis with wiki + source links and propose options.

### 8. Ingest the learning

- Misleading or missing wiki page → `/context-loop:wiki ingest` revise.
- A class of bug worth remembering → **Common pitfalls** bullet on the page (bounded at 7).
- A surface-specific gotcha → emit a `kb:gotcha` / `kb:incident` marker (`.claude/agent-protocol.md`); it reaches the agent's playbook through `/context-loop:groom`.

Bump `last_verified` only on pages whose claims you re-verified.

## Cross-app debugging tips

- **Stuck payments:** `/api/reconcile` (user app) is the safety net — `Bearer` `RECONCILIATION_SECRET` or `CRON_SECRET`; 503 when neither is set. POST it manually to clear a backlog.
- **Webhooks:** every webhook re-fetches from the provider; the body only names the payment. Mollie validates the `tr_` id, Stripe verifies `stripe-signature` (Connect events need `event.account`), Viva is unsigned and trusts only the re-fetched transaction (`.claude/rules/payments.md`).
- **Demo payments:** `pi_demo_*` refs are fake; `isDemoPayment()` from `@repo/data/payment-refs` is the one check — never a private `startsWith`.
- **`@repo/data/PrismaCient`:** the typo is intentional — every app depends on the path. Don't "fix" it.
- **Preview vs test:** both run against the TEST DB, so a migration applied for `main` is live for test.sunbnb.app too (`.claude/rules/migrations.md`).

## Anti-patterns

- **Guessing the cause and writing a fix.** Verify, then fix.
- **Defensive code that masks the symptom.** Find the root cause.
- **Bypassing safety checks to "make it work"** (`--no-verify`, removing an ownership guard, skipping webhook re-fetch). Never.
- **Re-deriving the flow from source** when the flow page exists.
