---
id: CR-001
title: "Make the partner /legal/verifactu page say what is true today"
status: new
priority: 1
company_ref: [M-37, T-57]
created: 2026-11-18
track:
outcome:
---
## Task: make the partner Veri*factu notice page say what is true today

**Page:** `apps/partner/app/legal/verifactu/page.tsx`, live at https://partner.sunbnb.app/legal/verifactu and linked from the partner footer. Copy-only change. Don't touch the Veri*factu implementation, the declaración responsable page (`apps/partner/app/legal/declaracion-responsable/page.tsx`) or any env or AEAT settings.

### Why
Prospects, investors and town halls can read this page, and today it says two things that are not true:

1. **It describes live compliance.** "The Sunbnb platform generates Veri*factu-compliant receipts…", with check-marked features ("Every receipt includes a QR code formatted per AEAT specifications…", cryptographic chaining, the receipt contents ending in "the Veri*factu-compliant QR code"), and a disclaimer that says we "provide the Veri*factu-compliant receipt generation feature". Track `.claude/tracks/026-verifactu.md` says production is not live: `AEAT_MODE` is unset on production and there is no production certificate. Go-live waits on the founder's D4 (sign the declaración responsable), D3 (production clean-slate delete) and an explicit "production". The transport passed AEAT preproducción on 13 Nov 2026.
2. **It gets the dates wrong.** "Compliance became obligatory from 1 January 2026" and the banner "Spanish Tax Mandate — Veri*factu (January 2026)". In force today (RDL 15/2025 amending disp. final 4ª of RD 1007/2023): systems must be operational before **1 Jan 2027** for corporate-tax payers (art. 3.1.a) and before **1 Jul 2027** for the other obligated taxpayers, autónomos included. On 5 Oct 2026 Hacienda announced a further postponement to October 2028, but no BOE norm has been published, so don't state 2028 as law.

The founder decided (M-37) to soften the page now, before go-live.

### What to change
Re-verify all of the above against the track and the code before you edit, and stop and ask if the code now says otherwise. Then:

- **Header and banner.** Change the effective date to the deploy date. Replace "(January 2026)" with the real deadlines: 1 Jan 2027 for companies paying corporate tax, 1 Jul 2027 for other taxpayers, including autónomos. If you mention the announced postponement, add one short line saying a postponement to October 2028 has been announced but not yet published in the BOE.
- **"What Is Veri*factu?"** Keep it. It describes the regulation, not us. Keep the accurate sentence that AEAT doesn't certify software and that the producer self-declares. The "Read Sunbnb's declaration" link may stay, but the D4 declaration is not signed yet, so check what the linked page shows today. If it presents an unsigned declaration as signed, flag it rather than changing it.
- **"How Sunbnb Supports Your Compliance".** Rewrite in the future or in-progress tense. The approved operator wording is: **"Sunbnb is building Veri*factu support for the 2027 deadlines."** Remove the check marks, or show the items as planned, not done. Say plainly that receipts are not yet sent to AEAT from production, and that partners will be told before it goes live. No "compliant", "certified", "homologado" or "guaranteed", and no "ensures compliance".
- **Receipt contents and record retention.** Keep only what production does today. Check the receipt and export code, and drop "the Veri*factu-compliant QR code" from the list until go-live.
- **"Your Obligations".** Keep. Add one line: until Sunbnb's Veri*factu support is live, partners need their own compliant invoicing for sales that fall under the obligation.
- **Disclaimer.** Change "provides the Veri*factu-compliant receipt generation feature" to wording that matches the new status, for example "is developing Veri*factu receipt generation…". Keep the no-tax-advice and liability language.
- **Tone.** Plain, short sentences a beach-bar owner can read. No marketing words.

### Acceptance criteria
- On the page, none of these appear: "compliant", "complies", "ensures compliance", "certified", "homologado", "January 2026", "obligatory from 1 January 2026".
- It states the 1 Jan 2027 and 1 Jul 2027 deadlines correctly, and does not state October 2028 as law.
- The "How Sunbnb supports" section reads as in progress and contains the approved sentence.
- Nothing outside `apps/partner/app/legal/verifactu/page.tsx` changes, except a matching translation file if the page uses one. Grep for other public copy that repeats these claims (partner landing, marketing app, emails, the PDF receipt template text) and **list** what you find, but don't change it in this task.
- Typecheck and lint pass for the partner app, and the page renders locally.
- Deploy follows the repo's normal flow. Give the founder a before/after screenshot or the diff of the visible text.

### Out of scope
Going live with Veri*factu (D3, D4, production env), the declaración responsable page, pricing or tier pages, and any change to receipt generation.

### Report back
The diff of the visible text, any other places that repeat the claims, and anything in the code that contradicts this prompt.
