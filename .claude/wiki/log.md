# Wiki Log

Append-only chronological record of wiki changes and ingests. Newest entries at the bottom.

Entry format (consistent prefix is intentional — it's machine-parseable):

```
## [YYYY-MM-DD] <op> | <summary>
- changed: <file>, <file>
- reason: <one sentence>
- by: <human handle or "auto">
```

Operations:
- `bootstrap` — wiki structure created or restructured
- `ingest` — new code/info absorbed into the wiki
- `lint` — health check pass; usually followed by `revise` entries
- `revise` — corrected or expanded an existing page
- `retire` — marked page stale or removed it

---

## [2026-05-20] bootstrap | LLM wiki established
- changed: `.claude/wiki/README.md`, `.claude/wiki/index.md`, `.claude/wiki/log.md`, `.claude/wiki/workflows/*.md`, `.claude/wiki/entities/*.md`, `.claude/wiki/flows/*.md`, `.claude/wiki/subsystems/*.md`, `CLAUDE.md` (added wiki pointer)
- reason: establish a navigable, LLM-curated knowledge layer over the existing `CLAUDE.md` + `PROJECT_CONTEXT.md` + `.claude/rules/` documentation, modelled on Karpathy's three-layer wiki pattern. Seeded with schema, index, log, 6 workflows, 5 entity pages (reservation, order, invoice, service-fee, settlement), 5 flow pages (reservation-payment, order-payment, rental-booking, walk-in, settlement-cycle), 2 subsystem pages (auth, payments).
- by: claude (opus-4-7)

## [2026-05-20] bootstrap | maintenance discipline added
- mode: revise + add
- changed: `.claude/wiki/README.md` (added page sizing budgets, bounded-section caps, update modes table, refined maintenance discipline with single wiki-worthiness test); `.claude/wiki/workflows/ingest.md` (full rewrite — decision-led structure with worthiness gate, YES/NO criteria, update-mode selection); `.claude/wiki/workflows/lint.md` (added severity tiers, health metrics, hand-off section); `.claude/wiki/workflows/prune.md` (new — active removal of dead content); `.claude/wiki/workflows/review.md` (new — periodic strategic re-pass); `.claude/wiki/index.md` (added prune + review to workflows catalog; grouped maintenance loop vs per-task use); `.claude/commands/wiki.md` (new — thin slash command dispatcher: ingest / lint / prune / review with auto-suggest when no subcommand)
- reason: address the gap Karpathy's pattern leaves open — explicit gates for what's wiki-worthy, bounded sections to prevent bloat, paired lint/prune so removal is intentional, and a periodic review to question whether the wiki's shape still matches the project's shape. Single test for any write: "Will future Claude write better code or answer questions faster because of this update?"
- by: claude (opus-4-7)

## [2026-05-20] add | /context check + /context sync (multi-layer probe & tracker)
- mode: add + revise
- changed: `.claude/scripts/detect-drift.mjs` (NEW location, extended to multi-layer: wiki + canonical via `--scope` flag); `.claude/wiki/scripts/detect-drift.mjs` (DELETED — moved); `.claude/context/workflows/check.md` (NEW — stateless probe procedure); `.claude/context/workflows/sync.md` (NEW — stateful tracker procedure); `.claude/context/state.json` (NEW — cursor file, gitignored); `.claude/commands/context.md` (NEW — slash dispatcher: check / sync / status); `.gitignore` (added `.claude/context/state.json`); `.claude/hooks/pre-push.sample` (updated to new script path); `.claude/wiki/scripts/install-hook.sh` (updated to new script path); `.claude/wiki/workflows/lint.md` (noted `--quick` is now alias for `/context check --scope wiki`); `.claude/commands/wiki.md` (same); `packages/data/CLAUDE.md` (fixed `prisma/schema.prisma` → `packages/data/prisma/schema.prisma` — drift caught by first canonical-layer scan).
- reason: address the asymmetry where the wiki had both stateless drift detection (`/wiki lint --quick`) and recent-changes ingest (`/wiki ingest`), but the canonical layer had only the latter (`/update-knowledge`, naive `git log main..HEAD`). The two new commands fill the gap: `/context check` is stateless multi-layer probe, `/context sync` is the stateful tracker with a per-developer cursor in `.claude/context/state.json`. Both dispatch to existing `/wiki ingest` and `/update-knowledge` for actual writes — no per-layer logic reinvented.
- by: claude (opus-4-7)

## [2026-05-20] revise | unified maintenance gate around five qualities
- mode: revise
- changed: `.claude/wiki/README.md` (primary-objective sentence in header; replaced "The single test" with "The gate" + five-qualities table); `.claude/wiki/workflows/ingest.md` (gate reframed using five qualities; YES criteria tagged with which qualities they gain; new criterion 6 "Ambiguity resolved" for deterministic); `.claude/wiki/workflows/prune.md` (added "How this workflow serves the gate" — concise + deterministic gains framing); `.claude/wiki/workflows/review.md` (Quality signal questions now mapped to each of the five qualities); `.claude/wiki/workflows/lint.md` (severity tiers tagged with qualities at risk); `.claude/commands/wiki.md` (added objective statement at top); `.claude/commands/update-knowledge.md` (worthiness gate reframed using five qualities, with note that layer-2 bloat compounds across sessions).
- reason: replace the previous single-question gates (phrased differently in three files) with one canonical five-qualities formulation. Updates must gain at least one of (informed, effective, reliable) and sacrifice none of (concise, deterministic). The qualities are concrete enough to test against an update; the constraint side prevents bloat that the gain side alone would allow.
- by: claude (opus-4-7)

## [2026-05-20] bootstrap | drift detection automation
- mode: add + patch
- changed: `.claude/wiki/scripts/detect-drift.mjs` (new — Node script, no deps, scans wiki for broken `sources:`/inline-ref/cross-ref); `.claude/hooks/pre-push.sample` (new — warn-only hook); `.claude/wiki/scripts/install-hook.sh` (new — installs hook with backup); `.claude/wiki/workflows/lint.md` (added two-modes section: quick vs full); `.claude/commands/wiki.md` (recognize `lint --quick` flag); `.claude/commands/update-knowledge.md` (layer-separation note + Step 6 wiki ingest hint); `.claude/commands/review.md` (Step 6 wiki ingest hint); plus drift patches surfaced by first script run: `entities/reservation.md` (`services/` → `service/`), `subsystems/auth.md` (`auth.ts` → `app/auth.ts` for all 3 apps), `flows/reservation-payment.md` (`payment/page.tsx` → `payment/Payment.tsx`, `sendConfirmation` → `sendConfirmationEmail`).
- reason: pair the existing user-driven workflows with a cheap mechanical detector so drift caught between sessions costs ~0 tokens. The script formalizes the grep recipes from `workflows/lint.md` "Tooling shortcuts". Soft couplings on `/update-knowledge` and `/review` add proactive nudges at the moments the user is already touching the doc layer.
- by: claude (opus-4-7)

## [2026-05-20] add | subsystem:schematic-editor page
- mode: add
- changed: `.claude/wiki/subsystems/schematic-editor.md` (new — draft); `.claude/wiki/index.md` (registered under Subsystems)
- reason: the shared grid-geometry + editor-chrome layer (`@repo/schematic`, `@repo/schematic-editor`) is the single shared capability behind the sunbed inventory editor, the user sunbed-selection UI, and the restaurant tables editor — but had no synthesis page. Created as the cited shared-knowledge source for the new `sunbed-inventory` specialist agent and the `/schematic` skill. Status draft: core grid math + chair-util verified against code, editor-chrome internals not yet fully read.
- by: claude (opus-4-7)
