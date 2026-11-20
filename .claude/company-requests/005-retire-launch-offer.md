---
id: CR-005
title: End the public "30 days free" launch offer (hide it, stop new grants, keep existing ones)
status: done
priority: 2
company_ref: A-24 (approved product prompt, granted 2026-11-19), T-141 (split from T-130 / A-22)
created: 2026-11-19
track: (none: single-session change)
outcome: "Done 2026-11-19 on branch co/CR-003-retire-launch-offer (engineer run R20261119-133605-engineer; filed as CR-003, renumbered CR-005 on 2026-11-20 because co/CR-003-try-sunbnb-seo also used CR-003). Landed via co/CR-merge-backlog (T-161). offerFor() returns null in en/es/fi; the site-assistant fact `launch-offer` is removed; signup no longer grants launch-30d, and grantLaunchPromotionIfEligible is a no-op that returns false. Existing grants, the admin grant/revoke buttons, isCommissionWaived, planTrialEnd, the clock and the trial-sync cron are unchanged. TEST DB: 0 partner_promotion rows. Production was not readable from the sandbox."
---

Filed by the engineer from the founder-approved product prompt A-24 (task T-141). The prompt text is below,
verbatim.

## Task: end the public "30 days free" launch offer

### Why
The public plans become Gratis (EUR 0, one site, up to 100 hamacas) and Temporada (2% of online-paid sunbed and rental bookings, capped at EUR 199 per site per month). The marketing home page still shows "Oferta de lanzamiento: sin comisión ni cuotas mensuales durante 30 días ... hasta el 31 de mayo de 2027". That contradicts the new model, and any launch offers are made one to one by the company, never advertised on pages or ads. So the public offer ends.

### Current behaviour (read on 2026-11-19)
- `apps/marketing/lib/offer.ts`: `OFFERS` per locale (en, es, fi) with `launchOffer`, `launchOfferShort`, `founderPromise` (all locales `founderPromise: null`). `offerFor(locale)` returns `null` when `launchOffer` and `founderPromise` are both falsy, which hides the block. The file comment says the offer is enforced by billing and the copy and code must change together.
- `apps/marketing/lib/offer.test.ts`: three copy guards (no placeholders, same slots in every locale, short form exists exactly when the full terms do), plus a test "the launch offer copy matches what billing enforces" that imports `LAUNCH_PROMOTION` from `@repo/data/promotion` and requires "30", "2027" and "31" in every locale's text. That last test fails once the copy is null.
- Readers: `apps/marketing/app/page.tsx` and `apps/marketing/app/m/[token]/page.tsx` call `offerFor`; `apps/marketing/components/Experience.tsx` (around line 772) shows `OfferPill` only if `launchOfferShort`; `apps/marketing/components/OfferNote.tsx` renders `launchOffer` and `founderPromise`. These already handle null.
- `apps/marketing/lib/agent/knowledge.ts` (around line 176): a fact entry `id: 'launch-offer'`, `status: 'shipped'`, `say: OFFERS.en.launchOffer ?? ''`, `figures: [30, 31, 2027]`. With null copy this would be an empty "shipped" fact, and the site assistant could keep talking about the offer. Check for any tests or eval fixtures that read it (`apps/marketing/eval/results/*.json` are historical outputs; leave them).
- Billing side, `packages/data/src/promotion.ts` (pure rules: `LAUNCH_PROMOTION` code `launch-30d`, 30 days, join cut-off 2027-05-31 22:00Z; `isEligibleForLaunchPromotion`, `isCommissionWaived`, `planTrialEnd`, `startsPromotionClock`) and `packages/data/src/promotion-db.ts` (`grantLaunchPromotionIfEligible`, `grantLaunchPromotion` for admins, `revokeLaunchPromotion`, `stampPromotionClock`, `listPromotionsForPlanSync`).
- New grants happen automatically at partner account creation: `apps/partner/app/account/actions.ts` (around line 86) calls `grantLaunchPromotionIfEligible`.
- Existing grants take effect at charge time: payment creation in `apps/user/app/api/{tab-payment,order-payment}/mollie/create-payment/route.ts` and `apps/user/app/api/payment/mollie/create-rental-payment/route.ts`, the confirmation path (`packages/data/src/payment.ts`, `rental-payment.ts`, `reservation-machine-apply.ts`), the Stripe plan trial in `apps/partner/app/api/subscription/checkout/route.ts` (`planTrialEnd`), and the daily cron `apps/partner/app/api/cron/sync-promotion-trials/route.ts` (scheduled in `apps/partner/vercel.json`).
- Admin: `apps/admin/app/partners/[id]/LaunchOfferCard.tsx`, `actions.ts` (`grantPartnerPromotion`, `revokePartnerPromotion`) and `page.tsx` show and manage the promotion per partner.
- Other readers of the promotion: `apps/partner/lib/assistant/inspect/money.ts` (explains waived commission to the venue assistant). Mocks and tests: `apps/admin/__mocks__/@repo/data/promotion-db.ts`, `apps/partner/__mocks__/@repo/data/promotion-db.ts`, `apps/partner/app/account/actions.test.ts`, `apps/partner/app/api/subscription/checkout/route.test.ts`, `apps/partner/lib/assistant/inspect/inspect.test.ts`, `packages/data/src/promotion.test.ts`, `promotion.integration.test.ts`.

Re-read these files first; line numbers move.

### The change
1. **Hide the public offer.** In `apps/marketing/lib/offer.ts` set `launchOffer` and `launchOfferShort` to `null` in en, es and fi, so the home page, the immersive first screen and the `/m/[token]` page show no offer block. Keep `founderPromise: null`. Update the file comment: there is no public launch offer; terms for any individual offer are agreed one to one and never published here.
2. **Fix the tests.** Keep `offer.test.ts` passing: the placeholder, same-slots and short-form guards stay as they are. Replace the "matches what billing enforces" test with one that asserts no locale shows a launch offer (both fields null) and that `offerFor` returns null for en, es and fi. Do not keep a test that requires "30/2027/31" in copy.
3. **Site assistant.** In `apps/marketing/lib/agent/knowledge.ts` remove the `launch-offer` fact (or make it not appear when the copy is null) so the assistant never describes a public offer. Update any test that lists the fact ids.
4. **Stop granting to new partners.** `grantLaunchPromotionIfEligible` must no longer create a `launch-30d` promotion at sign-up. Simplest: make it a no-op that returns false (or stop calling it in `apps/partner/app/account/actions.ts`) and update `actions.test.ts` accordingly. Do not change the join cut-off constant to achieve this; the intent is "no new automatic grants", not "the window moved".
5. **Keep honouring existing grants.** Any partner who already holds a non-revoked `launch-30d` promotion keeps the waived commission and the Stripe plan trial for the rest of their window. Do not delete rows, do not revoke, do not change `isCommissionWaived`, `planTrialEnd`, the clock stamping or the sync cron. Existing admin grant and revoke buttons keep working. Before changing anything, tell us how many promotion rows exist and which are active, read from the TEST database only if that is what the sandbox allows (if production counts cannot be read, say so in your hand-in and we will check separately); no data migration is needed either way.
6. **No replacement public offer.** Do not add a discount, percentage, end date or new offer text anywhere public. Optional, only if the page looks broken or empty without the block: a plain line from the catalogue values for the free entry plan ("Gratis: 0 €, una sede, hasta 100 hamacas", with en and fi equivalents), read from the plan catalogue keys created by the plan catalogue prompt, never typed in twice. If the page reads fine without it, add nothing.
7. **Check nothing else advertises it.** Search all apps and message files for the old offer wording ("30 días", "30 days", "Oferta de lanzamiento", "Launch offer", "Lanseeraustarjous", "31 May 2027"); remove any public hit. Merchant legal pages that describe the offer, if any, should be reported rather than rewritten.

### Acceptance criteria
- With the change, `/` and `/m/<token>` in en, es and fi render no launch-offer text or pill; `offerFor` returns null for all three locales.
- A partner account created after the change has no `launch-30d` promotion row; a partner who had one still gets commission waived and the plan trial as before (cover with the existing promotion tests, adjusted).
- `apps/marketing` tests, `apps/partner` account and subscription tests and `packages/data` promotion tests pass; typecheck passes; no test requires the old copy.
- The site assistant knowledge no longer contains a launch offer.
- No percentage discount, free period or end date appears on any public page as a result of this change.

### How to test
Run the marketing, partner, admin and data package test suites and the typecheck. Load the home page in each language and confirm the first screen and footer show no offer. Create a partner account in the test environment and confirm no promotion row appears; use an existing test partner with a promotion to confirm a charge is still waived.

### Out of scope
Changing plan prices or limits (that is the plan catalogue prompt); removing the promotion tables or module; new public copy about offers; changing the existing partners' windows.

### Open questions for the product session
1. **Reuse for the admin grant of the 2027 reference offer.** The plan catalogue prompt (item 9) needs an admin-only way to give a chosen venue Temporada at 0% commission until a date. The existing promotion module already has an admin grant, revoke, a per-partner card and clock logic. But it waives for 30 days from the first live paid booking and also trials the Stripe plan, which is not "free for the whole 2027 season". Should the module be generalised (a per-grant end date instead of 30 days from the first booking) and used for that grant, or should the module be removed and a separate mechanism built? Recommendation: reuse it with a dated variant if that is small, because the admin UI, expiry and billing hooks exist, but say what you find.
2. How many partners hold a promotion today and how many are active? Anything about them that this change would break?
3. Does `isEligibleForLaunchPromotion` or the cut-off date appear anywhere that decides something other than the offer?

## Engineer report (2026-11-19)

**Re-verification.** Every code claim above matched `app/main` at `1a9f6572`, except that no test or eval fixture
lists the knowledge fact ids (only the historical `eval/results/*.json`, left alone).

**What changed.**
- `apps/marketing/lib/offer.ts`: `launchOffer`/`launchOfferShort` set to null in en/es/fi. The comment says there is no
  public offer and individual offers are agreed one to one. `offer.test.ts`: the three guards are kept, and the billing
  test is replaced by "no locale shows a launch offer; `offerFor` is null for en/es/fi".
- `apps/marketing/lib/agent/knowledge.ts`: the `launch-offer` fact is removed, along with the now-unused `OFFERS` import.
- `apps/partner/app/account/actions.ts`: the signup no longer calls `grantLaunchPromotionIfEligible`. `actions.test.ts`
  now asserts that a new account gets no grant and that no `partnerPromotion` write happens.
- `packages/data/src/promotion-db.ts`: `grantLaunchPromotionIfEligible` is a documented no-op that returns false, so
  a stray caller cannot re-enable automatic grants. `LAUNCH_PROMOTION.joinCutoff` is unchanged. The integration test
  now asserts no grant, 0 rows, and an unchanged cut-off. The tests for existing grants (waived commission on
  reservation/order, clock stamping, revoke, plan trial) pass unchanged.
- Item 6: nothing added. `OfferNote`/`OfferPill` render nothing on null, and the page has no hole where the offer was.
- Item 7: no public hit remains in any app or message file. The remaining "30 días / 30 päivän" hits are the
  projection hint ("a 30-day month") and the Veri*factu "2027 deadline" lines, which are not about the offer. No
  merchant legal page describes the offer (the partner privacy "30 days" is assistant-upload retention).

**Open questions.**
1. *Dated admin grant for the 2027 reference offer.* Reuse it. The module is small and a dated variant fits it:
   `PartnerPromotion` already has `endsAt`, and `isCommissionWaived`/`planTrialEnd` read `endsAt` once it is set. A
   new `code` (e.g. `season-2027`) granted by an admin with `startedAt` and `endsAt` set at grant time, plus clock
   stamping that skips codes that already have an `endsAt`, and `activeLaunchPromotion` (today it matches
   `launch-30d` only) widened to accept the new code, would give "0% until a date" and reuse the admin card,
   revoke and charge-time hooks. The open decision is whether that grant should also trial the Stripe plan
   (`planTrialEnd`); for a season-long grant it probably should not. Decide this in the catalogue CR (CR-002 / T-130).
2. *Counts.* TEST DB has **0** `partner_promotion` rows (0 active). Production could not be read from the engineer
   sandbox, so the company needs to check it separately. Nothing in this change affects existing rows.
3. *Other uses of `isEligibleForLaunchPromotion` / `joinCutoff`.* None. They were used only by
   `grantLaunchPromotionIfEligible` (now a no-op) and by tests. `isEligibleForLaunchPromotion` is now unused in
   production code; it stays because the prompt rules out removing the module.

## Merge note (2026-11-20, T-161)

Landed in main through `co/CR-merge-backlog` together with CR-001, CR-003 (try.sunbnb.app SEO) and CR-004.
This change was filed as CR-003 in parallel with the SEO request; it is renumbered CR-005 (file, frontmatter and
the code comments that cited it). The merge with `app/main` was clean: the plan names and prices in main
(CR-002 and the founder's later plan rework) are the base truth, and this change touches neither. The prompt
text above is kept verbatim as approved.
