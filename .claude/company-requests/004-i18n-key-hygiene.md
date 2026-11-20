---
id: CR-004
title: i18n key hygiene — user/partner locale parity, typo key, rentals delete dialog, parity test
status: done
priority: 3
company_ref: T-103, A-19, A-30, T-57
created: 2026-11-19
track:
outcome: "Committed 7ea3c080 on co/CR-004-i18n-key-hygiene (from app/main 9c956041); not pushed (D-6). Preferred delete-dialog option taken."
---
# CR-004: i18n key hygiene (user and partner apps)

Filed by the engineer agent (run R20261119-155127-engineer) from the founder-approved product prompt
(A-19, build approval A-30). The prompt is reproduced verbatim below the line; the re-verification and
answers to its open questions are under "Engineer notes" at the end.

---

## Goal

Make the translation files of the `user` and `partner` apps consistent: every key present in `en.json` is present in `es.json` and `fi.json` and vice versa, and a test keeps it that way. A Spanish venue operator using the partner app should never see a raw key or an English fallback on a screen we ship in Spanish.

## Why

The Spain launch (2027 season) puts Spanish-language operators in front of the partner app. A key-parity check on 2026-11-18 (company task T-57, gaps list item 7, deliverable `deliverables/spain-launch-product-gaps.md`) found three mismatches. The `marketing` app is clean (313 keys in en and es, no differences). This request fixes the mismatches and adds a guard.

## Current behaviour (read on 2026-11-18, please re-check before editing)

I flattened each JSON file to dotted keys and compared. Counts: user en 352, es 351, fi 351; partner en 1988, es 1988, fi 1988 (equal counts, but different keys: one missing each way).

1. **`apps/user/messages/en.json` line 73**: key `Reservations.Paymemnt received` ("Payment received"), a typo. The correct key `Reservations.Payment received` is on the next line of en.json and exists in `es.json` (line 73, "Pago recibido") and `fi.json` (line 73). The typo key exists only in en.json. A grep of `apps/user` (excluding node_modules and .next) found no code using `Paymemnt`.
2. **`apps/partner/messages/es.json` and `fi.json`, namespace `SiteRentals`**: key `category` is missing. It exists in `en.json` line 1134 ("Category"). The rentals form uses it at `apps/partner/app/sites/[id]/rentals/view.tsx:97` (`t('category')`, with `useTranslations('SiteRentals')`). Result: the Category label in the rental-item form has no Spanish or Finnish text. (Note `SiteRentals` also has `itemCategory` in all three files; check whether that is the intended key.)
3. **`apps/partner/messages/es.json` line 1151 and `fi.json` line 1151, namespace `SiteRentals`**: key `deleteConfirmTitle` ("¿Eliminar artículo?" / "Poistetaanko tuote?") is missing from `en.json`. Nothing reads it: the delete dialog in `rentals/view.tsx` (around lines 481-487) is hardcoded English ("Are you sure you want to delete ...", "This item has N booking(s) ..."). `en.json` has `SiteRentals.deleteConfirmBody` at line 1152 but the dialog does not use it either. Other namespaces also have a `deleteConfirmTitle` (line 654 in all three files), so do not touch those.

Existing test setup: both apps use vitest (`apps/user/vitest.config.ts` includes `app/**/*.test.ts`, `store/**`, `brands/**`; `apps/partner/vitest.config.ts` includes `app/**`, `lib/**`, `components/**`). Run with `npm test` in each app (or `npm test` at the root via turbo). Neither app currently has a messages-parity test (searched for tests touching `messages/`: none found).

## The change

1. In `apps/user/messages/en.json`, delete the `Reservations.Paymemnt received` line. Keep `Payment received`.
2. In `apps/partner/messages/es.json` add `SiteRentals.category`: `"Categoría"` (same wording `itemCategory` and line 2121 use in es). In `fi.json` add `"Luokka"` (as at line 2121). Keep the key order the same as `en.json`.
3. `SiteRentals.deleteConfirmTitle`: it is an orphan. Pick the cleaner fix and tell me which:
   - preferred: wire the delete dialog in `rentals/view.tsx` to `t('deleteConfirmTitle')` and `t('deleteConfirmBody', { name })`, add `deleteConfirmTitle: "Delete item?"` to `en.json`, and translate the booking-count sentence with a new key in all three locales; or
   - minimal: remove the unused `deleteConfirmTitle` from `es.json` and `fi.json`.
4. Add a parity test in each app (for example `apps/user/app/i18n/messages-parity.test.ts` and the same in partner, matching the app's test include globs). It loads `messages/en.json`, `es.json`, `fi.json`, flattens nested objects to dotted keys, and fails with a readable list of "missing in X" / "extra in X" keys. Duplicate keys inside one JSON object are silently collapsed by `JSON.parse`; if cheap, also detect duplicates by a small scan of the raw text (the partner files repeat names like `deleteConfirmTitle` across namespaces, which is fine; only same-object duplicates matter).
5. Optional, only if trivial: have the same test report values that are empty strings.

## Acceptance criteria

- The flatten-and-compare script (or the new test) reports zero differences between en, es and fi in `user` and `partner`.
- `grep -rn "Paymemnt" apps/` returns nothing.
- The partner rental-item form shows "Categoría" under locale `es` and "Luokka" under `fi`.
- `SiteRentals.deleteConfirmTitle` is either used by the dialog and present in all three files, or absent from all three.
- The new tests pass in both apps (`npm test` in `apps/user` and `apps/partner`), and fail if you temporarily delete a key from `es.json`.
- No other test breaks.

## How to test

Run `npm test` in `apps/user` and `apps/partner`. Then delete one key from `es.json`, confirm the parity test fails and names the key, and restore it. Open the partner rentals page with the Spanish locale and check the form label.

## Out of scope

- Translating or reviewing the quality of existing Spanish text (a native-speaker review is a separate job).
- Changing keys in the `marketing` app (already consistent).
- Adding new locales or changing the i18n library setup.
- Any change to other `deleteConfirmTitle` keys.

## Open questions for you

- Is `SiteRentals.category` or `SiteRentals.itemCategory` the intended key for the form label? Only `category` is read by `view.tsx`; `itemCategory` may be dead.
- Should the delete dialog be translated now (preferred option) or is removing the orphan enough for this change?
- Is there a CI step where the parity test should run in addition to the per-app `npm test`?

---

## Engineer notes (2026-11-19, run R20261119-155127-engineer)

**Re-verification against `app/main` 9c956041.** Counts are now: user en 384 / es 383 / fi 383,
partner 2016 in all three, marketing 312 in all three.
- Item 1 still held. `Reservations.Paymemnt received` was at `apps/user/messages/en.json:105`, en only,
  and no code read it. It is removed.
- Items 2 and 3 were already fixed by CR-002 part C (merged into main). `SiteRentals.category` is
  "Categoría" / "Luokka", and en has `deleteConfirmTitle: "Delete item?"`. The dialog itself was still
  hardcoded English, and es/fi `deleteConfirmBody` meant something different from en ("will be
  permanently deleted", no `{name}`).
- CR-002 already added `apps/partner/app/test/i18n-parity.test.ts` (key sets only). This CR extends that
  file rather than adding a second one, and puts the same file in `apps/user/app/test/`.

**What changed (7ea3c080)**
- user `en.json`: typo key removed.
- partner `rentals/view.tsx` delete dialog: uses `deleteConfirmTitle`, `deleteConfirmBody` (t.rich, item
  name in bold), the new `deleteConfirmBookings` (ICU plural) and `cancel` / `delete`, in en, es and fi.
  es/fi `deleteConfirmBody` rewritten to match en. `SiteRentals` has no other reader.
- Parity test in both apps: missing/extra keys per locale, duplicate keys inside one object (raw-text
  scan), empty values (prompt item 5).

**Answers to the open questions**
- `category` vs `itemCategory`: `category` is the key the form reads. `itemCategory` is read by nothing in
  `apps/` (dead), but it is present in all three locales, so it is left alone (out of scope).
- Delete dialog: translated now (the preferred option).
- CI: the tests are under each app's vitest include globs, so `npm test` and `turbo test` run them. No
  extra CI step is needed.

**Verification.** Both parity tests pass (9/9 each). Negative checks: deleting
`SiteRentals.deleteConfirmBookings` from es fails with "missing in es"; a repeated empty
`Reservations.Payment received` in user en fails the duplicate and empty-value tests. Files restored after.
Partner: tsc clean, lint 0 errors, 124 files / 3379 tests pass. User: lint 0 errors, 59 files / 981 tests
pass (1 skipped). User tsc reports only TS2307 on `.png`/`.jpg` imports, because this clone has no
generated `next-env.d.ts`. That is unrelated to this change. `grep -rn Paymemnt apps/` returns nothing.
Rendering through next-intl's `createTranslator`: es shows Categoría, fi shows Luokka, and the dialog
strings come out correctly in the singular and the plural in all three locales. No browser check: the
partner page needs an authenticated HTTPS session.

**Copy to read before release** (partner, `SiteRentals`):
- `deleteConfirmBody`: en "Are you sure you want to delete <b>{name}</b>?" · es "¿Seguro que quieres
  eliminar <b>{name}</b>?" · fi "Haluatko varmasti poistaa tuotteen <b>{name}</b>?"
- `deleteConfirmBookings`: en "This item has # booking(s), which will also be removed." · es "Este
  artículo tiene # reserva(s), que también se eliminará(n)." · fi "Tuotteella on # varaus/varausta,
  joka/jotka myös poistetaan."

No migrations.
