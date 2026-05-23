---
type: workflow
slug: debugging
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:query
  - subsystem:payments
  - subsystem:auth
last_verified: 2026-05-20
---

# Workflow: Debugging

Procedure for diagnosing a reported problem. The wiki accelerates this by letting you orient on the relevant subsystem in seconds instead of grepping.

## Procedure

### 1. Restate the symptom precisely

Strip interpretation; capture what the user observed:
- What did they do?
- What did they expect?
- What did they see?
- Which app? Which environment (local, test, production)?
- Is it reproducible? On which inputs?

### 2. Map the symptom to a flow

Identify which `[[flow:…]]` page (or pages) the failing behaviour lives in.

| Symptom hint | Likely flow |
|---|---|
| Booking didn't create / payment screen errored | `[[flow:reservation-payment]]` |
| Order placed but no invoice | `[[flow:order-payment]]` → check **Side effects** |
| Equipment rental shows wrong availability | `[[flow:rental-booking]]` |
| Sunbed shown as available when it isn't (or vice versa) | `[[entity:reservation]]` (operational status) + `[[flow:reservation-payment]]` |
| Walk-in won't check in | `[[flow:walk-in]]` |
| Partner not seeing payout / wrong amount | `[[entity:settlement]]` + `[[entity:invoice]]` + `[[entity:service-fee]]` |
| Login / "you don't own this" | `[[subsystem:auth]]` |
| Webhook didn't fire / payment stuck | `[[subsystem:payments]]` → webhooks + reconciliation |

### 3. Read the flow / subsystem page

Look specifically at:
- **Sequence** — find the step where the failure could occur
- **Side effects** — figure out which side effects should have happened but didn't (or shouldn't have happened but did)
- **Failure modes** — see if this is a known failure pattern with a documented recovery

### 4. Form hypotheses, ranked

Cheap to disprove first. Typical ranking:

1. **Auth/ownership** — wrong user, missing `anonId`, missing sudo. Check the relevant `requireSiteOwner()` / `verifyOwnership()` call.
2. **Status field mismatch** — a state machine transition that didn't fire. Confirm `status` and `operationalStatus` values match the constants module.
3. **Idempotency / double-write** — invoice created twice, or not created because a prior partial run set inconsistent state.
4. **External provider state** — Mollie payment status diverged from DB. Check the Mollie dashboard / payment id.
5. **Webhook missed** — reconciliation endpoint should be a safety net; if it's not catching this, that's a second bug.
6. **Env var missing** — esp. `RECONCILIATION_SECRET`, `CRON_SECRET`, `MOLLIE_*`.
7. **Race condition** — concurrent availability check + create. Wrap-in-transaction was missed.

### 5. Verify against code

For each candidate hypothesis, open the relevant file (cited in the flow page) and trace the code path. Use `Grep` for status string usages, function call sites, env var references.

For DB state questions, ask the user to run a Prisma Studio query (`cd packages/data && source .env.local && npx prisma studio`) — usually faster than guessing.

### 6. Confirm root cause

Don't propose a fix until you can explain:
- The exact line(s) where the bug originates
- Why the bug happens (the precise condition)
- Why no existing safeguard caught it
- What the correct behaviour is (with citation — wiki page or canonical rule file)

### 7. Fix or report

If small and well-understood: fix and add a regression test. If big: write up the diagnosis, link to the relevant wiki + source, propose options.

### 8. Ingest the learning

If the bug exposed:
- A misleading or missing wiki page → revise it
- A class of bug worth remembering → add a **Common pitfalls** bullet to the entity/flow page
- A non-obvious gotcha → append to `.claude/knowledge/<agent>.md`

Update `last_verified` on any page you re-verified during the debug.

## Cross-app debugging tips

- **Stuck payments**: `/api/reconcile` (user app) is the safety net. It requires `RECONCILIATION_SECRET`. POST it manually to clear backlogs.
- **Webhook verification failures**: the Mollie webhook validates the payment-id regex then re-fetches state from the provider. (The partner subscription Stripe webhook needs `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` matched to the dashboard.)
- **Demo mode confusion**: anything starting with `pi_demo_` is a fake payment ref. `isDemoPayment(ref)` (in `apps/user/app/api/_lib/payment-ids.ts`) is the canonical check.
- **`@repo/data/PrismaCient`**: the typo path (missing 'l') is intentional — every app depends on it. Don't "fix" it.
- **Status field typos**: every status value lives in `packages/data/src/reservation-status.ts`. Searches for raw strings like `'expected'` or `'checked-in'` will turn up usages — always prefer the constant.

## Anti-patterns

- **Guessing the cause and writing a fix.** Verify, then fix.
- **Adding defensive code to mask a symptom.** Find the root cause.
- **Bypassing safety checks to "make it work."** (`--no-verify`, deleting `requireSiteOwner`, skipping the webhook signature check.) Never.
- **Skipping the wiki and re-deriving the flow from source.** The flow page exists precisely so you don't.
