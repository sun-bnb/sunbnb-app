---
id: 027-beach-mockup-lead-agent
title: Beach mockup lead agent — marketing landing page that builds a prospect's beach
status: active
created: 2026-10-04
updated: 2026-10-09
worktree: null
---

## Goal

A landing page for ads and other marketing sources that turns a venue operator into a lead by
**showing them their own beach running on Sunbnb**. The prospect enters where their beach is
and how many sunbeds they have; within seconds they see an interactive mockup — sunbeds laid
out on the real satellite image of their beach, clickable, with a demo booking flow — and an
AI agent beside it answers questions and moves them toward a demo call or signup.

End state: a separate `apps/marketing` app, form-first funnel, deterministic mockup generator,
an API model (Claude) carrying the live conversation, a local open-weights model doing the
background work nobody waits on (lead summaries, transcript grading, objection analysis), and
leads landing in the DB with a summary the founder can act on.

## Decisions (founder, 2026-10-04)

- **D1 — Form first, chat second.** Two fields (beach location + sunbed count) render the
  mockup immediately; the agent appears alongside *after* the prospect has something to look
  at. Ad traffic bounces off an empty chat box; it does not bounce off its own beach.
- **D2 — Separate app: `apps/marketing`.** Own SEO, analytics, ad-pixel and deploy surface;
  the consumer booking app is untouched by marketing experiments. Port **3004**.
- **D3 — Hybrid by latency: API for the live conversation, local for background work**
  (founder, 2026-10-04 — REVISED the same day; see Log). The first reading of "local for
  privacy and experience" put the whole conversation on a local model. P0 data said otherwise,
  and the founder confirmed the original intent was the split:
  - **Live conversation → API** (Claude Haiku 4.5 default). A prospect waits on every reply,
    and reply quality is what converts. On the M1 Max with ONE user, qwen3:14b reached first
    token in 0.3 s but full replies took 10–28 s at p90; a production GPU box under concurrent
    ad traffic only gets worse. Cost is ~1–2 cents per conversation with no always-on GPU.
  - **Background work → local open-weights model.** Lead summary + score at session end,
    LLM-graded eval of transcripts (tone, accuracy, pushiness — what regex scorers can't see),
    periodic objection/question analysis feeding the fact sheet and landing copy, follow-up
    email drafts for founder review. None of it is latency-critical, so it runs as batch jobs
    and needs no always-on inference host.
  - **Privacy, restated honestly:** the conversation now goes to Anthropic as a processor
    under its commercial API terms (no training on API data) — needs the DPA and a line in the
    privacy notice. Contact details reach OUR DB only through validated tools. Transcript
    ANALYSIS stays in-house on the local model. The hands-on-with-local-models goal is still
    met, on work where a slow or imperfect answer costs nothing.

- **D4 — The agent does NOT live on the partner landing page** (founder, 2026-10-04). The
  logged-out root of `partner.sunbnb.app` (`apps/partner/app/landing.tsx`, rendered from
  `app.tsx` when unauthenticated) is the front door of the operators' working app. Hosting
  the agent there would put LLM streaming, the Maps mockup bundle, ad pixels and a consent
  banner into the portal operators run their beaches on; mix cold ad prospects with existing
  partners logging in; and couple weekly funnel experiments to partner-app releases. Instead
  the partner landing page gets ONE CTA ("See your beach on Sunbnb →") into the marketing
  form, tagged `utm_source=partner-landing` (P1). Later, once the agent proves it converts,
  consider making `apps/marketing` the single public sales site and reducing the partner
  root to sign-in — two public partner pages duplicate pricing/copy and compete in search.

- **D5 — Served from its own subdomain: `try.sunbnb.app`** (founder, 2026-10-04). Its own
  Vercel project; test environment follows the existing `partnertest.sunbnb.app` pattern
  (e.g. `trytest.sunbnb.app`, confirm at setup). A path under `partner.sunbnb.app` via Next.js
  Multi-Zones (marketing `basePath` + a `beforeFiles` rewrite in the partner app) was viable
  and rejected: it puts the ad page on the operator portal's ORIGIN, so any third-party ad
  pixel would run with access to the portal's `localStorage` and non-HttpOnly cookies, and the
  portal's session cookies would be forwarded to the marketing app on every request. A
  separate origin isolates all of it for one DNS record and keeps normal ad pixels and fast
  experiments available. The partner landing CTA (D4) is a plain cross-origin link.

- **D6 — P3 data & consent rules** (founder, 2026-10-04): retention **90 days** for mockups
  without contact, **24 months** for leads with contact, both from last activity (daily
  `/api/cron/purge-leads`); the privacy notice lives on **try.sunbnb.app/privacy** (its version is
  stored on each lead as `consentVersion`); a demo request **emails the team in P3** (Resend →
  `LEADS_NOTIFY_EMAIL`, default info@sunbnb.app), not deferred to P6; bot protection is
  **honeypot + minimum fill time + per-IP rate limit**, Turnstile only if abuse appears.

- **D7 — Live chat model: Claude Haiku 4.5** (founder, 2026-10-04), chosen over Opus 5.5 on
  latency (0.6 s vs 1.5 s to first token) and cost, knowing its first-run misses were real
  (didn't book a call it had a phone for, offered a guessed email, "not sure" about a listed fact).
  Consequence: those misses become prompt fixes that must pass the eval before P5 ships.

- **D8 — Landing rebuild: conversion-grade, app-faithful, game-like journey** (founder,
  2026-10-05; full plan in `~/.claude/plans/first-let-s-plan-the-gleaming-salamander.md`, P8–P14
  below). Decisions inside it:
  - **A/B: "book a demo" vs "self-serve free signup"** as primary CTA (variant B starts
    *concierge*: sign-in + the team seeds the site by hand, before the automated claim exists).
  - **Meta Pixel + Google Ads tags, loaded only after cookie consent**, plus first-party funnel
    events; the privacy notice's "no tracking cookies" line changes in the same release.
  - **Placement: OSM coastline for direction + an AI vision check for the dry sand**, gated on an
    imagery-licensing check (Google terms restrict deriving data; prefer open orthophotos).
  - **Proof = a launch offer + a founder-led promise**, terms supplied by the founder;
    placeholders fail a production-build test until filled.
  - **Projection with zero new required inputs**: sunbed count from the mockup, price the
    prospect typed (never our €20 demo pre-fill) or their website's posted price; Starter
    headline needs no maths; everything else optional and labelled "your estimate".
  - **Local intelligence "beach brief"**: AI researches and selects, never authors facts — every
    figure has a source and passes a citation check; cost tiered so bounces cost ~nothing and
    Opus spend scales with leads (regional facts batch-precomputed per municipality).
  - Map = the app's styled roadmap (`mapId 7a0196a7ba317ea5`) with the app's PNG sunbed /
    sunshade / towel layers; geometry rebuilt on partner's `generateChairGrid` so the mockup is
    exactly what partner creates on claim.

- **D9 — Launch offer, enforced by billing** (founder, 2026-10-05): **no commission and no plan
  fees for 30 days from the partner's FIRST LIVE paid booking, for partner accounts created by
  31 May 2027** (Madrid), new partners only (existing ones by hand from admin), and only LIVE
  payments start the clock (Mollie test-mode refs look identical, so off-production never starts
  it; `PROMOTION_CLOCK_IN_TEST=1` for QA). Built as `PartnerPromotion` + pure
  `@repo/data/promotion` + `promotion-db`; every charge point goes through
  `chargeableServiceFee(fee, partnerAccount, booking.createdAt)` — decided from the BOOKING's
  createdAt, so the Mollie applicationFee and the PLATFORM invoice can't disagree at the boundary.
  Founder promise: still to be chosen (slot hidden).

- **D10 — The page sells the platform, not one feature: ad-matched hero → qualifier → a demo
  assembled from feature modules** (founder, 2026-10-05). Trigger: the P9 journey made it look
  as if online sunbed booking were all Sunbnb does. Structure:
  - **Hero = ONE promise, matched to the ad** (`?a=` angle): bookings, drinks to the sunbed,
    paperwork done… One message per visit; which one depends on the ad.
  - **Qualifier asked DURING THE FLY-IN** (founder's call), not before the search: while the map
    flies in and the shore is read (~3–5 s of existing dead time), one tap-only question "What
    else do you run?" (beach bar / food · rentals · restaurant tables · just sunbeds) and an
    optional "What takes most of your time?" (cash & queues · staff · empty / no-show beds ·
    paperwork). Asking before the search would add a step before the payoff.
  - **The demo is assembled from ~20 s modules on their own beach**: guest books a sunbed
    (always, the anchor) · drink ordered to the sunbed → bar ticket (F&B) · paddleboard by the
    hour (rentals) · your morning: staff grid, one-tap check-in, QR walk-in payment (always) ·
    day close: cash + cards + invoices reconciled (pain = paperwork, or unanswered) ·
    Veri*factu-ready invoicing (Spanish beaches, claiming only what track 026 has shipped).
    Ends on a "Your Sunbnb" card of what they unlocked → projection (P10) → offer → CTA.
  - **Below the hero for scrollers**: three tappable pillars (more revenue · less work ·
    paperwork done) that each launch their module, "how it starts" in three steps, pricing line,
    an objections FAQ (guests without smartphones, walk-ins/cash still work, hardware, setup time).
  - **"Directed agentic" = rules choose the path, AI adds colour.** Module selection is a
    deterministic rule table over the qualifier answers — predictable, testable, free, and
    unable to invent a feature. The model maps free text onto the same answers, narrates
    modules with the local brief (P12), and answers in the chat (the escape hatch). An agent
    choosing the next module via a tool restricted to allow-listed modules is a later option,
    only if funnel data says the rules are too blunt.
  - **Gate: only shipped features are shown.** Each module is verified against the live product
    before it is built; the old partner `/info` page claims things (dynamic pricing, hotel
    channel) that need checking, and card-present (Viva, track 024) is not live.

- **D11 — Immersive UI: the beach IS the page** (founder, 2026-10-05). The first screen is one
  full-viewport live beach scene; content floats in it.
  - **One world start to finish**: the illustrated scene (canvas, no Maps API → fast LCP) hands
    over to the prospect's real map — camera rises to aerial, the map fades in, flies down to
    their shore. Maps JS loads only on intent (bar focus).
  - **One command bar for search AND the agent** (founder: yes): bottom thumb zone; accepts a tap
    (chips), a beach name (Places), or a sentence ("Platja de Muro, 80 beds and a bar") parsed by
    rules first (numbers, places, keywords) and by Haiku only when genuinely free-form. The agent
    speaks in bubbles anchored in the scene; every later step is a bubble + chips + the bar.
  - **Below-hero content = places along the same beach** (founder: yes): scrolling glides the
    camera to the beach bar (drinks to the sunbed), rental hut, staff/till (day close) — each
    tappable into its D10 module. Scroll stays NATIVE (pinned world, scroll-triggered camera; no
    hijacking); "how it starts", FAQ, footer remain ordinary content after it.
  - Guardrails: headline + bar visible without scrolling; reduced motion = still scene + cuts;
    headline / pillars / FAQ are real HTML (SEO, a11y), never canvas-only; free text maps onto the
    same structured answers (D10) — the agent cannot invent features.
  - **One conversation, start to finish** (founder, 2026-10-05: "same seamless interaction…
    Telegram style, but completely focused on the product experience"). Landing and `/m/<token>`
    are ONE `Experience` (world + thread + bar) in different states; "Build" swaps the URL in place
    (no navigation). Every tap/typed action is echoed as the visitor's message; step UIs ride on
    the agent's latest message as attachments; only the live step + last lines show, history on
    demand. **Haiku answers from the first screen** (founder): `/api/guide` — stateless, nothing
    stored, client-held capped history, tools only steer the page (`find_beach`,
    `set_sunbed_count`), per-IP + per-session caps; after "Build" the stored lead chat
    (`/api/chat`). Contact is a message in the bar (server-side capture), the form is optional.

## The premise that shapes every other decision

**The model does not draw the beach.** The mockup is *generated by code*: Google Places →
coordinates, sunbed count → a deterministic rows-of-pairs layout, rendered with the same map
machinery the partner inventory editor uses (`apps/partner/app/sites/[id]/inventory/InventoryMap.tsx`,
`@repo/schematic`). Image generation was considered and rejected: slow, expensive, gets counts
wrong, invents geography — and a picture is not clickable.

Consequences:

- **The funnel must work with the model DOWN.** Form → mockup → "book a demo" CTA is the
  conversion path; the agent augments it. An API outage costs us conversation, never the
  lead. (Same fail-safe doctrine as [[track:023]]: fall back to the plain path, never to
  an error.)
- **The model's job is narrow**: answer product questions from a fact sheet, handle
  objections, collect contact details, call a handful of tools. Narrow enough that the
  cheapest API tier should carry it — the eval harness decides, not intuition.
- **The mockup can seed a real site.** Layout output is geo-placed (lat/lng + rotation), the
  same shape `InventoryItem` stores (`locationLat`/`locationLng`/`rotation`). "Claim this
  beach" → partner onboarding with the inventory pre-placed is the long-term payoff (P7).

## Architecture sketch

```
apps/marketing (Vercel, fra1) — try.sunbnb.app
  /                  landing + form (Places autocomplete, sunbed count)
  /m/[token]         the mockup: map + demo booking + agent panel (shareable link)
  /api/chat          streams agent turns; holds tool implementations
        │  LIVE (latency-critical)
        ▼
  Claude API (Haiku 4.5 default)

background jobs (latency-insensitive, batch)
  lead summary + score · LLM-graded eval · objection analysis · follow-up drafts
        │  OpenAI-compatible HTTP
        ▼
  local open-weights model
    dev:  Ollama on the M1 Max (64 GB)
    prod: batch host TBD (Q3) — no always-on GPU required

packages/data
  Lead model (additive migration) — contact, placeId, coords, sunbedCount,
  layout JSON, bearing, utm_*, transcript, summary, consent, status
pure layout generator (location TBD — see Q2)
  (anchor lat/lng, bearing, count, options) → [{ lat, lng, rotation, pairId }]
```

- **Provider-agnostic seam**: `LeadAgentModel` (`apps/marketing/lib/agent/model.ts`). The
  OpenAI-compatible implementation serves every local runtime (Ollama, llama.cpp, vLLM); the
  live path adds a Claude implementation behind the same interface, so the eval harness runs
  either unchanged.
- **Tools**: `update_lead`, `adjust_mockup`, `request_demo` (`lib/agent/tools.ts`). The model
  PROPOSES, `validateToolCall` decides; the model never writes to the DB. Contact details must
  be **grounded** — found in what the prospect actually typed — because a model will complete
  "maria at chiringuitosol dot" into a perfectly valid, invented address (seen in P0).
- **Grounding**: prices, plans, payment providers, countries and features come from a
  versioned fact sheet in the system prompt. The agent must refuse rather than invent — a
  made-up price to a prospect is the worst failure this feature can have.

## Roadmap

- ✅ **P0 — Eval harness + model trial.** (Haiku 4.5 live path chosen and shipped in P5/P9c.) Harness DONE (`apps/marketing/eval/`, 20 scenarios,
  41 unit tests). Local pick DONE: **qwen3:14b** (40/40 vs mistral 24B 33/40, llama 8B 19/40).
  Slow-tail question answered: download contention, not the model. **Remaining:** Claude
  adapter behind `LeadAgentModel` and run Haiku 4.5 through the same suite — the live-path
  pick.
- ☐ **P0b — Local background jobs.** Lead summary + score from a transcript; LLM-as-judge
  grader added to the eval harness (alongside the regex scorers); a periodic objection
  analysis over stored transcripts. All on the local model via the OpenAI-compatible client.
- ✅ **P1 — `apps/marketing` scaffold + form.** DONE 2026-10-04 (browser-verified desktop +
  mobile, EN/ES; uncommitted). Original scope: Next 14 App Router, Tailwind (`/ui` priming;
  own `accent` token), next-intl EN/ES/FI, Places autocomplete via a server proxy (reuse the
  user app's pattern), sunbed-count input. No AI, no DB yet. Plus the D4 CTA on the partner
  landing page (`apps/partner/app/landing.tsx`) linking to `try.sunbnb.app` with UTM tags.
  **User ops:** create the Vercel project for `apps/marketing` (root dir, fra1) and attach
  `try.sunbnb.app` + the test-env domain (D5).
- ✅ **P2 — Layout generator.** DONE 2026-10-04 incl. v2 (OSM coastline snap), browser-verified
  on Platja de Muro + Barceloneta; uncommitted. Original scope: Pure, unit-tested: anchor + bearing + count → geo-placed
  pairs in rows parallel to the shore, walkways every N pairs, exact count, deterministic.
  Bearing v1 = heuristic + **user rotate/drag on the map** (interactive anyway); v2 = derive
  the shoreline bearing from OpenStreetMap coastline data (Overpass) — open data, no extra
  third party seeing the lead.
- ✅ **P3 — Mockup page + Lead model.** DONE 2026-10-04, browser-verified end to end against the
  local DB. Original scope: `/m/[token]` renders the generated layout on Google
  Maps; client-only demo booking (select bed → fake checkout → "this is what your guests
  see") — never writes real reservations. Additive `Lead` migration in `packages/data`
  (expand-only; `migrate:local` → `migrate:test` before pushing `main`). Consent + privacy
  notice on the form; retention period decided (Q4). Rate limit + bot check on the form.
- ✅ **P4 — Production wiring (live path).** DONE: route, caps, kill switch, privacy (2026-10-04);
  `ANTHROPIC_API_KEY` set in Vercel (production + preview); the spend limit is the in-code global
  daily AI budget (`MARKETING_AI_DAILY_TURNS`, default 2000, commit `120ce48`) since the key has no
  provider-side cap. The background (local-model batch) path moved to P0b. Original scope: Live: Anthropic key in Vercel env, prompt
  caching on the fact-sheet system prompt, per-session turn/token caps, spend alert, DPA +
  privacy-notice line. Background: the batch host from Q3 running the local pick on a schedule
  over new transcripts; nothing user-facing depends on it being up.
- ✅ **P5 — Agent panel.** BUILT 2026-10-04, browser-verified with live Haiku 4.5 against the local DB (uncommitted at time of writing). Original scope: Streaming chat on `/m/[token]` via `/api/chat`; system prompt =
  fact sheet + mockup context (beach name, count); tools wired; turn/session caps; graceful
  "assistant unavailable" state that leaves the CTA intact. Eval harness green before ship.
- ✅ **P6 — Lead handoff.** DONE 2026-10-06: `scoreLead` (points + reasons, `lead-model.ts`),
  admin `/leads` list + `/leads/[id]` (timeline, sudo-gated status), team email links the lead in
  admin, prospect gets their mockup link by email (EN/ES/FI). Plus a 4-row cap for narrow beaches.
  **Deferred to P0b:** the AI-written lead summary (local model).
- ✅ **P8 — Ad-ready baseline** BUILT 2026-10-05 (uncommitted at time of writing; browser-verified):
  consent banner + Meta/Google tags gated on consent; `lead_event` + `/api/events` + Lead funnel
  columns (migration `20261005055904_add_lead_funnel_fields`); hero by ad angle (`?a=`);
  offer/promise slots (null = hidden) + guard test; "no invented claims" copy test; sticky CTA.
  **Deferred to P9:** the real-app hero poster image (needs the app-faithful map capture) and the
  Lighthouse LCP measurement.
- ✅ **P8b — Full tracking stack.** DONE + deployed to production 2026-10-09 (`92a71d0`):
  Meta Pixel, Google Ads (3 conversions) + GA4 behind Consent Mode v2, PostHog EU (replay with
  inputs masked, canvas capture, via `/ingest` proxy), all consent-gated in `lib/marketing-tags.ts`
  with routing in `lib/tracking-plan.ts`; previously-unfired funnel events wired + `scroll_depth` /
  `section_view` / Web Vitals; consent + privacy re-versioned `2026-10-09`. Production and preview
  use separate Meta pixels and GA4 properties; Ads is production-only; PostHog is one shared
  project (free plan) with `environment` + an inclusive test-account filter. IDs: see log.
- ✅ **P9 — Journey + app-faithful map** (BUILT 2026-10-05, uncommitted, browser-verified mobile +
  desktop): app sprites (`scripts/build-sprites.mjs` → `public/app/*.webp`, `lib/app-sprites.ts`
  mirrors `SunbedSelection.tsx` layer for layer), `SunbedOverlay` sprite canvas + pop-in + LOD +
  hint rings + rising "paid" tag, styled roadmap (`mapId`) everywhere; landing = `HeroBeach`
  self-booking scene → `BeachSearch` → `BeachBuilder` (fly-in, shore snap, docked count control
  on mobile, Build waits for the shore answer); `/m/[token]` = `MockupJourney` missions (guest
  booking in an app-style sheet → staff grid in `@repo/floor-core` colours → go live), pure
  `lib/missions.ts` + tests. **Not done:** `beach-layout` on `generateChairGrid` (moves to P13,
  where partner geometry matters), hero poster image + Lighthouse.
- ✅ **P9b — Platform journey (D10)**: (1) shipped-feature audit → module catalogue with the
  real app surface each one mirrors; (2) qualifier chips in the fly-in + `lib/modules.ts` rule
  table (answers → ordered modules; pure, tested; every module id must exist in the catalogue);
  (3) modules beyond the two built (F&B order, rental, day close, Veri*factu ES); (4) "Your
  Sunbnb" summary card; (5) ad-matched hero headlines per angle; (6) below-fold pillars /
  how-it-starts / FAQ; (7) qualifier answers stored on the lead (additive columns) and passed to
  the chat + team email; funnel events per module.
- ✅ **P9c — Immersive shell (D11)**: full-screen scene first screen + floating headline + agent
  bubble + one command bar (rules-parsed sentence → beach + count; "near me" + example chips) →
  then the illustrated→map hand-off, the scroll-driven camera along the beach places, and the
  agent bubbles carried through builder and missions.
- ✅ **P10 — Projection** (`lib/projection.ts`, traced outputs, stored, emailed, chat-grounded).
- ☐ **P11 — AI placement** (after the imagery-licensing gate; eval of 15 labelled beaches).
- ☐ **P12 — Local intelligence brief** (tiered fetchers + research agent + citation verifier).
- ☐ **P13 — Variant B automated claim + A/B on** (partner `/claim/[token]`).
- ☐ **P14 — Server-side conversions + localized ad variants.**
- ◐ **P15 — Inland water: lake and river beaches** — Austria BUILT 2026-10-06 (local coastline DB; production import pending). Next regions: Finland (`europe/finland`), Spain's reservoirs (`europe/spain`). Not done: Overpass fallback for inland water outside imported regions. (founder, 2026-10-05: "will Austria handle Danube
  beaches?" — no). OSM `natural=coastline` / osmdata water polygons are the SEA only; a landlocked
  country imports nothing, and the Overpass fallback asks for coastline only, so lake/river beaches
  (Danube, Wörthersee, Neusiedler See, Saimaa) get no snap — the visitor turns the beds by hand.
  Scope: (1) import inland water polygons per country (Geofabrik extract, e.g. Austria ~700 MB:
  `natural=water` lakes/rivers + `waterway=riverbank`, above a size threshold) into the coastline DB
  as a second water layer; (2) derive the shore from the nearest polygon edge — the polygon interior
  is the water, so no line-direction convention to get wrong — and reuse `inWater` /
  `keepOnLand` / `shoreBand` unchanged; (3) Overpass fallback also asks for water areas;
  (4) a long-and-shallow layout (few rows along the bank) for narrow beaches — river strips need
  it, and narrow sea beaches already overflow into dunes/roads at 250 beds. Then regions: Austria,
  Finland's lakes.
- 💤 **P7 — Claim this beach** (superseded by P13). Lead → partner signup with the mockup inventory pre-placed
  (layout → `InventoryItem` rows). Cross-app (marketing → partner → data); needs its own
  architecture pass.

## Resume here

- **State 2026-10-09:** P0–P6, P8–P10 (+ P8b tracking stack) and the coastline DB are committed
  and deployed to test and production. Tracking verified on trytest (test pixel, test GA4 with
  `gcs=G111`, PostHog via `/ingest`). Next: **P13 claim flow**. It spans three surfaces (marketing → partner → data), so it
  needs an architecture pass and the founder's go-ahead before any code. Other candidates:
  P0b (AI lead summary), P15 (inland water).
- **Open with the founder:** "QR is true", but the knowledge base says staff look guests up rather
  than scan. Confirm whether a staff scanner exists before the agent claims it. The cancellation
  page says Sunbnb España SL processes refunds, while venues refund through their own Mollie.
- **Before production:** founder review of the new EN/ES/FI copy (Journey, Missions, Hero),
  `/privacy` (now also naming GA4 + PostHog), the founder promise wording; before running ads:
  billing on the Google Ads account and share the Meta pixel with the ad account; Viva zero-ISV
  answer (track 024) before Viva goes live; a production deploy activates `CRON_SECRET` on
  user/partner/admin.
- **Local dev gotcha:** if the marketing page renders unstyled, its `.next` went stale (every
  `/_next/static/*` 404s) — kill :3004, `rm -rf apps/marketing/.next`, restart `npm run dev`.
- **Context needed:** this file; plan `~/.claude/plans/first-let-s-plan-the-gleaming-salamander.md`;
  `/ui user` for the app's visual language; `packages/floor-core/src/bed-state.ts`
  (`getCellAppearance`) for staff-grid colours.

## Open decisions

- ~~**Q1 — What does "hybrid" mean?**~~ **Closed by D3 (revised):** API live, local
  background. Remaining sub-question: does a high-value lead (e.g. 200+ sunbeds) escalate to
  Sonnet mid-conversation, or is Haiku enough? Decide from the Haiku eval run.
- ~~**Q2 — Where does the layout generator live?**~~ `apps/marketing/lib/beach-layout.ts` until
  P7 needs it in partner; then move to a client-safe package (no prisma).
- **Q3 — Where do the local batch jobs run in production?** No longer an always-on GPU
  question. Options: a scheduled job on an EU GPU box rented by the hour; a CPU box running a
  smaller quantised model (slow is fine for batch); or, early on, the founder's Mac pulling
  from a queue (acceptable only while nothing depends on it — it is not production).
- **Q4 — Lead data retention + consent wording.** Transcripts are personal data; pick a
  retention window and whether transcripts are stored at all or only the summary. The notice
  must name Anthropic as processor for the live chat.
- **Q5 — Privacy residue to accept or address:** the location query still goes to Google
  Places/Maps. Acceptable (it's not the conversation), but the privacy notice must say so.
- ~~**Q6 — Anti-abuse.**~~ **Closed 2026-10-06** (see log): shared DB counters + global daily AI budget, still third-party-free; Turnstile only if abuse shows up. Ad traffic attracts bots; the in-memory rate limiter resets on every
  cold start. Options: Vercel KV/Upstash-backed limiter, Cloudflare Turnstile, per-token
  session turn/token caps on the API path (they now also cap spend).

## Log

- **2026-10-09** — **P8b tracking stack shipped to production** (`92a71d0`, promoted + deployed
  the same day). Accounts and IDs (all public/browser IDs, set in Vercel env, none in code):
  - Meta (business portfolio "Sunbnb"): prod pixel `1137291152067737`, test pixel
    `2386198708854158` (preview). Auto advanced matching / auto events / code-free tracking OFF;
    the portfolio-wide "Conversions API via Meta" left unticked (P14 does CAPI ourselves).
  - Google Ads "Refactory DX Oy" (498-484-2609, under vladimir@refactory.fi; Refactory RX Oy is
    dissolved): `AW-18502764587`, conversions Demo requested (primary), Partner signup (primary),
    Mockup created (secondary, count one). Enhanced conversions OFF. Production only — Ads only
    counts ad-click visitors, so no test account. No billing yet, €0 budget, no campaigns.
  - GA4 account "Sunbnb": prod property `G-RFWPTRYKF1` (558211380, 14-month retention, linked to
    Ads), test property `G-100MTN1FR6` (558200600, preview). Consumer app stays in PROP1.
  - PostHog EU project 299564 "Sunbnb – try.sunbnb.app" (free plan = 1 project): key on prod +
    preview, events carry `environment` (`NEXT_PUBLIC_APP_ENV`), project test-account filter
    `environment = production`. Replay: inputs masked, canvas capture on, request bodies OFF.
  - Also: `NEXT_PUBLIC_PARTNER_URL` = partnertest for all previews (was `test` branch only).
- **2026-10-09** — P4 closed: the key was already in Vercel and the spend limit is the in-code
  daily budget from `120ce48`; the roadmap line had simply not been updated.

- **2026-10-08** — D8 follow-through: the guest app's seat-map art went vector (geo map +
  schematic: green ring free, blue + check selected, red ring + towel reserved, pills below
  20 px), so the marketing copy of it moved too. The art is no longer duplicated:
  `lib/app-sprites.ts` → `lib/app-art.ts`, a thin adapter over `@repo/schematic/art`
  (`paintBed` / `paintParasol` paint the same `bed-art.ts` description the user app renders as
  SVG), and `HeroVignettes` uses `BedGlyphSvg`. `scripts/build-sprites.mjs` + `public/app/*.webp`
  deleted. Bed width is now the real 1 : 2.5 (was the old 1 : 2.1 tile). Browser-verified: hero
  beach, booking vignette, map overlay (60 beds).
- **2026-10-06** — **P15 inland water: Austria.** A region now names its Geofabrik extract
  (`INLAND_EXTRACTS` in `lib/coast-regions.ts`), and one import run does the sea (osmdata; Austria
  gets none, and its 2 079 tiles are marked "no coast" so Overpass is never asked) and the inland
  layer (`gis_osm_water_a_free_1`, read with the new `openDbf`). New coastline-DB tables:
  `inland_water` holds the polygons and `inland_shore` their edges in pieces of 200 points or
  fewer. Shapefile winding already puts the water on the right, the coast_line convention, so
  `nearestShoreFrame`, `keepOnLand` and `shoreBand` are unchanged. `waterNear` now UNIONs sea and
  inland water, so overlaps (river mouths, split sea pieces) cannot cancel in the even-odd test;
  sea bearings are identical before and after. Filters: fclass water / reservoir / riverbank
  (Geofabrik files the Danube as `riverbank`, not `river`), area ≥ 0.5 ha, and mean width
  (2A/P) ≥ 20 m. The width floor exists because the 12 m-wide Lendkanal out-snapped the
  Wörthersee. Austria keeps 5 973 of 70 821 polygons: 24 MB, imported in 11 s. Verified with
  PostGIS probes (water 15 m ahead, land 15 m behind) at Velden, Klagenfurt, Podersdorf,
  Gänsehäufel, Donauinsel, St. Gilgen and Attersee, and in the browser (rows parallel to the
  shore, facing the water). Copy: "facing the sea" → "facing the water" (EN/ES/FI).
  Found: `packages/data/scripts/coastline-schema.mjs` had never been committed (gitignored by
  `scripts/*.mjs`); now excepted.
- **2026-10-06** — **Bot protection (Q6), third-party-free per the 2026-10-04 decision.** Every
  marketing limit moved off the in-memory limiter, which reset on each cold start, onto
  `@repo/data/rate-limit-shared`. It is a fixed-window counter in `rate_limit_counter` (migration
  `add_rate_limit_counter`, additive): one atomic upsert per check, keys hashed with SHA-256, and
  an in-memory fallback if the DB is down. Policy lives in one table, `lib/limit-policy.ts`.
  AI turns pass the route's burst limit, then 150 per IP per day, then a **global daily budget**
  (`MARKETING_AI_DAILY_TURNS`, default 2000; 0 = off). That budget is the spend limit, since the
  Anthropic key has none. Over budget, the guide and chat answer `unavailable` and the page
  carries on rule-based; the team gets one email. "Your beach" emails are capped at 2 per
  recipient address per day. The purge-leads cron prunes dead counters. Verified: 25 racing
  requests let exactly 10 through (integration); live with a budget of 2, turns 3–4 got 503 and
  one alert; demo flow end to end.
- **2026-10-06** — **P6 lead handoff + narrow beaches** (`f62abd9`, `998348b`). `scoreLead` gives
  transparent points (demo 35, contact 15, guest demo 8, check-in 6, numbers 8, chat 6, extra runs
  6, size 4/10/16; capped at 100) with reasons. Admin `/leads` and `/leads/[id]` added. The team
  email links the lead in admin (`adminUrlFor`: try→admin, trytest→admintest). The prospect email
  sends their mockup link in their locale; email failures never block the request. `maxRows: 4`
  (250 beds stay within about 20 m of sand). Verified: data 919 unit + 576 integration tests,
  admin 239, marketing 246, lint 13/13, admin `next build`, and the Playwright demo-request flow
  (lead stored with runs + projectionAt).
- **2026-10-05** — **Coastline from our own data: deployed to test and production.** Contract
  migration `20261005171532_drop_app_coast_tables` (models + partner mock delegates removed) after
  test and production both ran 904c01c; applied to test before the push and to production by
  `deploy-to-production.sh`. Promoted (`00500f2`) and deployed by Claude (founder authorised
  promotes/deploys/migrations for the session). Verified live: trytest (via a Vercel-logged-in
  browser — Deployment Protection still on) and try.sunbnb.app `/api/coastline` answer Benidorm
  186°, Las Canteras 281°, Muro 76°, La Concha 307°, Tarifa 232°, each with water polygons, from
  the shared `coastline` database (coast_rw). Still open: Deployment Protection on the marketing
  project; more regions = one line in `lib/coast-regions.ts` + an import into the coastline DB.

- **2026-10-05** — **Coastline moved to its OWN database (founder: option A).** `CREATE DATABASE
  coastline` in the production Neon project (same compute, no new bill); schema is NOT a Prisma
  migration but `packages/data/coastline/schema.sql` (idempotent, PostGIS) applied with
  `npm run coastline:schema` (COASTLINE_POSTGRES_URL decides where). `coastline-db.ts` now issues
  raw SQL only over `COASTLINE_POSTGRES_URL` (required; unset → calls throw → the route falls back
  to manual turning) — no dependency on app models. Role `coast_rw` (LOGIN; CONNECT on coastline;
  SELECT/INSERT/UPDATE/DELETE on the three coast tables) — verified it has no USAGE on the app
  DB's public schema. Spain imported into it (17 s). Vercel `sunbnb-app-marketing`:
  `COASTLINE_POSTGRES_URL` = coast_rw@coastline, sensitive, Production + Preview (test and prod
  share one copy). Local: `coastline` + `coastline_test` databases in Docker
  (`test:integration:setup` applies the schema; integration tests truncate coastline_test only).
  Coastline rows deleted from the prod, test and local APP databases.
  **Contract step (done the same day, see the entry above):** test + production run `bfbc2f5`,
  whose coastline code still reads the app-DB tables when the env var is unset — drop them only
  after this code is deployed everywhere: remove CoastTile/CoastLine/CoastWater from
  schema.prisma + a `DROP TABLE coast_line, coast_water, coast_tile` migration (+ partner mock
  delegates), applied to test at promote and to prod at deploy.

- **2026-10-05** — **Bulk OSM coastline + water polygons (founder: options 1+2, Spain + Balearics,
  world-ready).** Migration `20261005151126_add_coast_water` (additive: `coast_water` polygons with
  GiST; `coast_tile.source`). `scripts/import-coastline.ts` streams osmdata.openstreetmap.de's
  `lines.shp` + `water_polygons.shp` (pure reader `lib/shapefile.ts`, no dependency; per-record
  bbox skips the rest of the world) for named regions (`lib/coast-regions.ts`: `spain` = mainland +
  Balearics + Canaries + Ceuta/Melilla; `world`). Imported lines get NEGATIVE ids; re-import replaces
  a region, Overpass rows untouched. `/api/coastline`: imported data near the point → answer from
  our tables only (no Overpass, no per-tile bookkeeping, so `world` works), else the Overpass
  read-through. Water polygons (clipped to the area, ~7 KB) make land/sea exact: `inWater`
  (even-odd over all rings), `verifyShoreFrame` flips a reversed coastline way,
  `signedShoreDistance`/`keepOnLand`/`parcelDepthFromWater` take the polygons' side over the line's.
  Spain import: 30 s, 5.5k segments + 137 polygons, ~44 MB with indexes. Local lookups 30–230 ms;
  La Concha, Benidorm, Las Canteras, Cala Millor, Tarifa, Barceloneta, Muro all face the right way.
  World: 79M + 79M points ≈ 4 GB.
  **One copy, shared (founder):** coastline data is public and identical everywhere, so test reads
  production's — `COASTLINE_POSTGRES_URL` points `@repo/data/coastline-db` (reads AND the Overpass
  read-through writes) at that database; unset = the app's own DB. Verified locally by pointing it
  at another DB: all coast reads/writes went there, the main DB untouched. Setup: import into
  PRODUCTION only (after its migration), then on the marketing Vercel project's preview/test env
  set `COASTLINE_POSTGRES_URL` to a production connection with a least-privilege role:
  `CREATE ROLE coast_rw LOGIN PASSWORD '…'; GRANT SELECT, INSERT, UPDATE, DELETE ON coast_line,
  coast_water, coast_tile TO coast_rw;` (the coast tables still exist, empty, in the test DB — the
  migration runs everywhere).

- **2026-10-05** — **P9c below the fold: a walk along the beach.** `BeachTour`: a sticky,
  full-screen world while the page scrolls natively (no hijacking); scroll progress pans the
  illustrated beach sideways and glides four places into view — beach bar (drinks), rental hut,
  front desk (staff grid), office (invoices; "Veri*factu coming before the 2027 deadline" for
  Spain) — reusing the hero's feature scenes, each with a real-HTML text card and "Try it on your
  beach" (scrolls up, focuses the bar). Then "How it starts" (place beds → prices + Mollie → share)
  and an objections FAQ (no smartphone, hardware, payouts, cost from PRICING_TIERS, languages) as
  server-rendered HTML. Replaces the old three-fact strip (`Facts` copy removed).

- **2026-10-05** — **P9c aerial hand-off.** Picking a beach: the illustrated beach recedes like a
  camera rising (scale 0.55, blur, fade); the real map mounts still at a regional zoom (10), fades in
  once its first tiles are drawn, and only THEN flies down to the shore (2.2 s). First attempt faded
  the map in on `tilesloaded` while already flying — Google keeps loading during camera motion, so it
  fired only after landing and the whole flight was invisible (blank sand). The shore snap and the
  camera framing now wait for the real landing (`onFlown` / `flown`) instead of a fixed timer, with a
  3× fallback so a map that never flies can't stall the visit.

- **2026-10-05** — **P10 projection built.** `lib/projection.ts` (pure, 8 tests): only the plan
  catalogue (`@repo/data/pricing-tiers`) + the prospect's own inputs — their sunbed price (from the
  guest booking; "Is €20 your price?" until they touch it) and, ONLY if they add it, sunbeds sold
  online on a typical day. Without that estimate: no monthly figures at all. Outputs per plan: what
  they keep of every online sunbed-day, break-even vs Starter in online sunbed-days a month, and
  (with the estimate) the 30-day cost + cheapest plan; every figure carries a trace shown under
  "How is this calculated?". Commission is on the price the guest pays (`calculateServiceFeeAmount`).
  Journey: summary → "See my numbers" → go live. Server action `saveProjection` recomputes from
  validated inputs and stores `lead.projection` (the column already existed from P8 — a duplicate
  field was caught by `prisma validate`); the team email shows "Their numbers"; the chat prompt
  gets "THE PROSPECT'S OWN ESTIMATES — restate, never extend"; eval scenarios restates-estimate /
  refuses-to-extrapolate (the scorer read "€1,800" as 1.8 — `parseFigure` now handles thousands
  groups). Haiku 54/54 ×2.
  **Bug found on the way:** after "Build" swaps the URL to `/m/<token>`, Next's patched
  `replaceState` moved its router to `/m/[token]`, so the NEXT server action (saveProjection,
  requestDemo) re-rendered that route — a fresh visit that wiped the conversation. The swap now
  passes `__NA` so the router stays put; verified the demo form submits inside the thread.

- **2026-10-05** — **Hero slides get their own scenes.** Founder: on every slide "the sunbeds never
  went away" — the feature showcase only changed tags on the same beach. Now booking keeps the live
  beach, and for every other slide the sunbeds fade out and that feature's scene scrolls in over the
  sand (`HeroVignettes`, a horizontal strip): a phone ordering to the sunbed + the bar's order board
  moving New → Delivered, a board rack with boards leaving and returning, the staff grid flipping
  reserved → checked in, a receipt printing then "Receipt sent". Scenes are designed at 250 px and
  scaled to the band they get; the sea stays as the shared backdrop. iPhone SE (320×568): offer pill
  truncates on short screens, chips scroll sideways under 400 px, stage min-height 560 px — before
  this the bar fell below the fold.

- **2026-10-05** — **P9b: the demo follows what they run (D10).** Pure rule table `lib/modules.ts`
  (`planModules`): fnb → drinks to the sunbed on the bar's order board (the map raises
  "Drinks · paid" on the guest's bed); rentals → paddleboard picked up / returned; tables → seat a
  party of four (too-small tables refuse); always → day close (only the demo's own figures: count
  of online payments, the visitor's own sunbed price, receipts, VAT); Spanish address → Veri*factu
  card, badged "coming before the 2027 deadline"; unanswered → drinks + day close. Each module
  maps to a knowledge entry (test). Then a "Your Sunbnb" summary (coming items never wear the
  green tick) → go live. Reducer: `continue` plays the next module, plan fixed once started, every
  step skippable (18 journey tests). The answer is stored on the lead (migration
  `20261005105847_add_lead_runs`, additive `lead.runs TEXT[]`; `parseLeadRuns`, 'none' = just
  sunbeds), so a reopened link replays the same modules, the chat prompt knows the venue
  (new eval scenario `knows-the-venue`; Haiku 48/50 ×2, misses were noise — capture-contact 4/4 on
  rerun) and the team email shows "Also runs". **Before pushing main: `npm run migrate:test`**
  (two pending: coastline cache + lead runs).

- **2026-10-05** — **Own coastline cache in PostGIS** (migration `20261005104249_add_coastline_cache`,
  additive: `coast_tile`, `coast_line` with a GiST index). Read-through by 0.1° tile (~10 km): the
  first lookup in a tile fetches its coastline from Overpass ONCE (`lib/overpass.ts`, instances
  raced, an Overpass "200 + timeout remark" is not cached as "no coast"), every later beach in the
  tile is answered from our table (~20 ms vs 5–9 s). `@repo/data/coastline-db` (DB) +
  `@repo/data/coastline-tiles` (pure, float-safe grid — `2.3 / 0.1` is 22.999…, found by the tile
  test). Seeding for campaign coasts: `npm run seed:coastline -- mallorca costa-del-sol …` (slow
  and polite; re-runnable, retries failed tiles). Playa Alonso, which never snapped, now does.
  **Before pushing main:** `npm run migrate:test`; before ads run, seed the campaign coasts against
  the test and production DBs (POSTGRES_URL decides which).

- **2026-10-05** — **First-screen feature showcase (founder spec).** The hero headline now cycles
  one feature at a time every 5.5 s — the ad's promise (sunbed booking) first, then drinks to the
  sunbed, rentals by the hour, the staff view / check-in, automatic invoices with VAT; only
  SHIPPED features (per `lib/agent/knowledge.ts`). `HeroSlides` stacks all slides in one grid cell
  (block height fixed by the tallest → the beach never jumps), slides up/out, timer-fill dots that
  can be tapped; the first slide stays the page's h1. `HeroBeach` takes a `mode` the running loop
  reads live (no restart): booking, drink tags on booked beds, a board rack + rental tags, green
  check-in ticks, receipt tags. The showcase pauses as soon as the visitor types or the thread
  moves; reduced motion = no cycling.

- **2026-10-05** — **Agent product knowledge (founder: "it wasn't sure about verifactu").** The
  ten-line fact sheet → `lib/agent/knowledge.ts`: 18 curated entries, each with a status
  (`shipped` / `coming` / `not_offered`), what the agent may say, `neverClaim` fences, declared
  figures and the code/track sources it was verified against (code audit 2026-10-05). Whole in the
  cached system prompt of BOTH agents (guide + lead chat) — no retrieval at this size; add a search
  tool over the same entries past ~40k tokens. Contract tests (`knowledge-schema.ts`): sources
  required, every stated number declared (feeds the eval allow-list), a `coming` entry can't read
  as live. Founder decision: **Veri*factu = "coming before the 2027 deadline"**, never live/certified.
  The audit found public overclaims the knowledge fences off: staff "scan" QR passes (no scanner —
  lookup by name/phone/email; also fixed in our own `Facts.f1` copy, EN/ES/FI), hourly sunbeds,
  Stripe for guests, dynamic pricing / discounts / forecasts / feedback / hotel channel
  (`apps/partner/app/info`), tiered refunds (`apps/user/app/cancellation-policy`; code refunds 100 %),
  the live Veri*factu legal page (QR + "certified"), and stale "5 % / 2 % / 0 %" fee upsells in the
  partner site settings (real ladder 6 / 3 / 1.5 %). Those pages are partner/user-app work, not
  fixed here. Eval: 4 new scenarios (verifactu, qr-scanning, hourly-sunbeds, dynamic-pricing);
  Haiku 4.5 47/48 ×2 (the miss: a Spanish pricing reply 3 words over the 120 cap).

- **2026-10-05** — **Copacabana: front rows still drawn in the sea — basemap ≠ OSM.** By the OSM
  coastline the front row stood 5.6–6 m up the sand, but Google's basemap draws water ~20 m
  further inland there (Platja de Muro happens to agree). The visitor sees Google's water, so
  placement alone can't fix it. Fix: paint the sand the beds were placed by — `shoreBand` (a strip
  along the OSM coast from the waterline to just behind the back row) + `parcelGround` (pad under
  the parcel), in the basemap's own sand colour `#f8ecd0` (sampled), under the beds. Invisible where
  the two agree, one continuous beach where they don't. Bug found on the way: drawing strip + pad
  as ONE canvas path cancelled their overlap (opposite windings) — a hole exactly under the beds;
  each shape is filled separately. Tests: band stays on the land side and follows a bend; pad
  covers every bed.

- **2026-10-05** — **Parcel kept out of the sea.** Founder: "rotated parcel tends to be partially
  out in the sea". `/api/coastline` now also returns the coastline within 500 m (`trimShore`); pure
  `signedShoreDistance` (water on the right ⇒ land +, sea −) and `lib/land-fit.ts` `keepOnLand`
  slide the whole parcel inland — perpendicular to the SHORE, not to the visitor's turn — until the
  front row and every row end are ≥ 4 m from the water (4 passes for curved shores; 7 tests incl. a
  headland, each asserting the parcel started in the sea). The corrected frame is what is drawn and
  saved. Also fixed: the first camera framing re-waited the whole fly-in on every re-trigger, so a
  fast (cached) snap left the camera on the Places point; it now waits only until the fly-in lands.
  Remaining: on a narrow beach a deep parcel (250 beds → 10 rows) runs into the dunes/road behind
  the sand — needs the back edge (dry-sand polygon, P11) or longer/shallower rows.

- **2026-10-05** — **Shore snap failed silently on uncached beaches.** Founder: "the parcel rotation
  isn't applied". Cause: public Overpass overloaded (main instance 504 after ~8 s; mirrors 14 s or
  silent) → `frame: null` → beds kept bearing 180 while the agent still said "facing the sea", and
  P9c had dropped the manual rotate/move controls. Fixed: `/api/coastline` races three instances
  (first non-empty wins, 7 s cap) — Copacabana now snaps via a mirror; the reducer's `shoreRead`
  carries `snapped`, and an unsnapped beach gets honest copy (`count*Manual`) + ↺ ↻ / Move in the
  count step; manual adjustments are saved with the lead (`adjusted=1`). Playa Alonso still gets no
  answer in time. **Durable fix proposed:** our own coastline table in PostGIS (OSM
  coastlines/water polygons for the target coasts, GiST-indexed) — milliseconds, no third party at
  ad traffic.

- **2026-10-05** — **P9c: one conversation over one world (uncommitted).** `components/Experience`
  (shell) + `World` (illustrated scene → map, never remounts) + `Thread` (bubbles, live
  attachment, collapsed history) + `ThreadAttach` (step UIs) + `Composer` (`useBeachSearch` + the
  one bar); pure `lib/journey.ts` reducer (14 tests: echo-as-message, qualifier in the fly-in never
  traps, stale-step events ignored, change-beach only before a mockup); `lib/guide.ts` +
  `/api/guide` (10 tests: anonymous bounded input, forged `<page_state>` stripped, tools validated
  and dropped when out of bounds); `lib/intent.ts` gains question/bare-count/price/yes routing.
  `createMockup` returns the token instead of redirecting. Removed: `BeachBuilder`,
  `LandingJourney`, `CommandBar`, `MockupJourney`, `MockupView`, `ChatPanel`; message namespaces
  `Journey`/`Missions`/`Agent`/`Mockup` → one `Thread`. Privacy notice: the assistant answers before
  a mockup (questions not stored until then) → `CONSENT_VERSION` 2026-10-05.2.
  Browser runs (iPhone 13 + desktop, live Haiku) caught and fixed: the agent called `find_beach`
  for "do you work with beach bars?" (tool description + rule now say OWN beach only); a tall
  thread made the camera frame the beach in a sliver and zoom to the parcel outline (camera inset
  capped at half the screen, thread capped, 3 lines visible); the reopened link's first framing was
  overridden by the fly-in (first fit waits for it); the full demo form in the thread read as a web
  form (now behind "Use a form instead"); focusing inputs scrolled the page under the map (pinned).
  Open: lead-chat replies run long for a thread (system prompt allows 3 sentences — eval-guarded);
  the chat doesn't yet know the qualifier answer (P9b step 7).

- **2026-10-05** — **D11 recorded; P9c first-screen prototype built (uncommitted).** Full-screen
  `HeroBeach` world fitted to the floating UI by measurement (shore under the headline block, 1–3
  bed rows in whatever band is left); headline + short launch-offer pill (`launchOfferShort`,
  full terms on tap; guard test: short exists iff full does) on the sea; agent bubble + one
  `CommandBar` (replaces `BeachSearch`) in the thumb zone with "Near me" (autocomplete biased to
  coordinates rounded to ~1 km, `parseNear`) and "Show me an example" chips. Sentences are read by
  pure `lib/intent.ts` (count needs a unit word in EN/ES/FI so an address number never becomes a
  count; also detects bar / rentals / tables for the D10 qualifier). Verified iPhone 13, iPhone SE,
  1440 desktop: "Platja de Muro, 80 beds and a bar" → builder opens at 80, shore-snapped. Phones
  hide the subtitle (bubble + scene carry it) and short screens shrink the headline, or the bar
  fell below the fold on an SE.

- **2026-10-05** — **D10 recorded; P9 journey built (uncommitted).**
  - Founder: the page read as "we make sunbeds bookable online" only. Decided: ad-matched
    one-promise hero, a qualifier asked during the fly-in, and a demo assembled from feature
    modules chosen by a rule table (AI narrates and maps free text; it does not pick features).
  - P9 findings that became code: on mobile a sticky map hid the count control → the control
    moved into a bottom dock with the Build button; the cookie banner covered that dock → top
    of screen on mobile; a cold Overpass answer took 4.6 s and Build pressed before it saved the
    parcel unturned on the Places point (on a road) → Build queues until the shore answer, and
    `createMockup` only saves `placement = 'waterline'` layouts; fitBounds rounded to whole
    zooms and shrank the beds → `isFractionalZoomEnabled`.
  - Superseded and removed: `MockupWorkspace`, `DemoBookingPanel`, `StickyCta`, `BeachForm`
    and the `Booking` / `Cta` message namespaces.

- **2026-10-05** — **D9 launch offer built** (migration `20261005062737_add_partner_promotion`, additive).
  - Charge points wrapped: payment creation (`reservation-payment.ts`, `rental-payment.ts`, user
    order/rental/tab Mollie routes) and confirmation (`processConfirmed{Reservation,RentalBooking,
    Order,TabPayment}`, deposit, `calculateOrderServiceFee`, `calculateTabTotal`). With no fee the
    existing `> 0` guards already skip the Mollie applicationFee and the PLATFORM invoice — so no
    empty €0 commission invoices and no Veri*factu record for one.
  - Clock stamped write-once in the confirmation transaction under the per-partner
    `lockInvoiceSeries` (5 paths); demo / off-platform / cash / test accounts never start it.
  - **Viva (card-present) REFUSES promoted bookings with an explicit error** instead of guessing:
    `isvDetails` also names the merchant to pay and Viva's `assertValidIsvFee` rejects 0 — whether
    a zero ISV fee is possible is track 024's open Q2/Q3. Must be resolved before Viva goes live.
  - Plan fees: checkout adds a Stripe `trial_end` (`planTrialEnd`); partner cron
    `/api/cron/sync-promotion-trials` (daily 04:30, CRON_SECRET) aligns trialing/active
    subscriptions to `endsAt` once the clock starts — only ever extends, idempotent vs Stripe.
  - Grant at partner signup (`submitForm`, never blocks it); admin partner page shows status and
    can grant/revoke (sudo).
  - Tests: 18 pure + 11 integration (real Postgres, real invoicing path) — **mutation-checked**:
    disabling the waiver fails 4 of them. Checkout trial + cron (6), admin actions (4), signup (3).
  - Offer copy live on the landing hero and above the demo form (EN/ES/FI), guarded by a test that
    its 30 days / 31 May 2027 match `LAUNCH_PROMOTION`.
- **2026-10-05** — **P8 built.** What it does and what the browser run proved:
  - **Consent**: banner with equal-weight "Accept all" / "Only necessary"; Meta Pixel + Google
    Ads tags injected only after acceptance and only when `NEXT_PUBLIC_META_PIXEL_ID` /
    `NEXT_PUBLIC_GOOGLE_ADS_ID` are set (Ads conversions need `NEXT_PUBLIC_GOOGLE_ADS_LABEL_*`).
    Verified with dummy ids: **zero** requests to Meta/Google before a choice and after "Only
    necessary"; after "Accept" the tag hosts load and the pixel is live on the mockup page.
    Consent given on the landing page is stored on the lead at creation (it didn't exist yet).
  - **Funnel**: allow-listed names, flat ≤ 1 KB props; anonymous before the lead exists, linked
    after (and then the LEAD's variant/angle, not the caller's). Conversions (`mockup_created`,
    `demo_requested`) are counted SERVER-side; the browser only fires the ad pixel, with an
    `event_id` for P14 de-duplication. A full run produced exactly one event per moment.
  - **A/B**: arm derived from the token (sticky, no cookie), live arms from `MARKETING_VARIANTS`
    (unset = `a` only), `?v=` QA override honoured only for live arms.
  - **Copy guards**: the claims test caught every Emergent-page phrase ("100+ beaches", "35 %",
    "3 of 12 slots", "hundreds of…", "cientos de playas", "guaranteed") and passes honest copy;
    first version flagged plain nouns like "clientes" — narrowed to digits, %, number words,
    guarantee words.
  - Privacy notice: "no tracking cookies" replaced by a cookies/advertising/measurement section
    (EN/ES/FI); `CONSENT_VERSION` → `2026-10-05`; separate `COOKIE_CONSENT_VERSION`.
  - Dev-only double events (React Strict Mode double-mount) fixed with once-per-page guards.
- **2026-10-04** — **P4 + P5 built: the live chat on the mockup page.** `/api/chat` (Haiku 4.5 via
  `LEAD_AGENT_MODEL`, default `claude-haiku-4-5`) — client sends only the new message; the
  transcript lives on the lead (`chat_sessions` JSON, one session per page visit; migration
  `20261004191649_add_lead_chat`, additive, also adds `business_type`); 30 msgs / 10 min per IP,
  40 prospect messages per lead (`LEAD_CHAT_MAX_TURNS`), 1,000 chars per message, `maxDuration` 30;
  the panel renders only when `ANTHROPIC_API_KEY` is set (kill switch = unset it) and every failure
  degrades to a note pointing at the demo form. Past sessions are NEVER rendered — anyone with
  the link could read contact details typed into them. Privacy notice gained the chat section
  (Anthropic as processor, transcripts stored, contact-in-chat = request to be contacted);
  `CONSENT_VERSION` → `2026-10-04.2`, chat leads record `chat-2026-10-04.2`.
  Haiku tuning, eval 36/40 → **59/60** (the miss: 62 words vs a 60 cap). What moved it:
  - **Bug in `runTurn`, all models:** a model can answer AND call a tool in one step, then add
    nothing after the tool result — the loop reported only the last step, so real answers came
    back EMPTY. Reply is now every step's text (`run-turn.test.ts`).
  - **Haiku believed `request_demo`'s optional `notes` were required** and asked "what should the
    team cover?" instead of booking. Fixed in the TOOL description ("every other field is
    OPTIONAL… never ask for them before calling"), not the prompt.
  - It still sometimes asked for a name first. So the critical action left the model:
    **`contact-capture.ts` — when the prospect's message contains an email/phone, the SERVER
    books the demo before the model replies**, shown to the model as its own completed
    `request_demo` (with a note to still save name/count). Extracted values are substrings of
    the prospect's text, so they pass the grounding check by construction; phone rules reject
    dates/prices/counts (+ needs 7–15 digits, otherwise ≥ 9). Same switch in the eval.
  - "Not sure about Greek": the fact sheet listed languages but not that there are no others.
  Live run: Q&A in ~2.5 s; "actually 140 sunbeds" redrew the map; "+34 600 123 456, call me"
  → `demo_requested`, phone + chat consent stored, 11-message transcript, public page clean.
- **2026-10-04** — **P3 built.** `lead` table (migration `20261004181552_add_marketing_lead`,
  additive; applied local, `sunbnb_test`, TEST DB), `@repo/data/leads` (create / public read /
  save layout / request demo / purge) + pure `@repo/data/lead-model` — 13 unit + 11 integration
  tests. Marketing: form → `createMockup` action → `/m/<token>` (12-char unguessable token);
  layout + shore snap persisted, so a shared link reopens with zero coastline calls; tap-a-sunbed
  guest booking demo (client-only, explicit "no payment" note, QR pass); "Request a demo" form →
  contact + consent + team email; `/privacy` (EN/ES/FI, controller from `getBusinessEntity`).
  Findings:
  - **The public read SELECTS beach/layout columns only** — contact data is never read on
    `/m/<token>`; asserted by an integration test AND by fetching the page HTML after a demo request.
  - **`Number(null)` is 0**: the first timing check let a request with no timestamp through as
    "rendered in 1970". Caught by a test written against the requirement; now digits-only.
  - **Seen from above the umbrellas hide the beds**, so a tapped/booked bed's fill change was
    invisible; selection is now an outline drawn above everything.
  - Vercel (marketing): placeholder `POSTGRES_URL` replaced with the real per-target URLs
    (copied from admin: production → prod DB, preview/development → test DB), `RESEND_API_KEY`,
    and a FRESH `CRON_SECRET` (marketing only).
  - **Cross-project finding, NOT fixed here:** no Vercel project (user, partner, admin) and no
    team-level env defines `CRON_SECRET`, and every existing cron route fails closed (503)
    without it — partner `reservations-cleanup`, user `send-reminders` + `prune-telemetry`,
    admin `verifactu-submit`. If production matches the API listing, those jobs are not running.
    Founder to confirm in the Vercel cron logs before anything changes.
  - **Privacy notice is a DRAFT legal text** (`apps/marketing/lib/privacy-content.ts`) — founder
    review required before production; bump `CONSENT_VERSION` when its substance changes.
- **2026-10-04** — **Claude adapter** (`lib/agent/claude-model.ts`, `@anthropic-ai/sdk`): streaming,
  cached system prompt, tool results batched into one user message, assistant turns replayed from
  Claude's own blocks (preserved thinking), effort `low` for chat latency, server-side refusal
  fallback (`fallbacks: "default"`) on the 5.x line. `eval/run.ts` routes `claude-*` models to it.
  Smoke run (multi-turn close): Opus 5.5 passed (TTFT 1.9 s, fuller answers, booked the demo);
  Haiku 4.5 failed the invented-figures check by illustrating 6 % with a made-up €10 drink.
  **Full run (`--repeat 2`, effort low):** Haiku 4.5 36/40, TTFT 0.60 s median / 0.85 s p90,
  full call 1.3 s; Opus 5.5 37/40, TTFT 1.5 s / 2.8 s p90, full call 2.9 s. Reading the failures
  changed the ranking: Opus's two `invalid-email` fails were a SCORER bug (it gave a format
  example, "name@domain.com" — check narrowed to addresses built from the prospect's text) and its
  third was 64 words vs a 60 cap; Haiku's were real — given a phone and "call me tomorrow" it
  asked for name + email instead of booking, it offered `maria@chiringuitosol.com`/`.es` itself,
  and it said it was "not sure" about Greek when the fact sheet lists the languages. So: Opus 5.5
  ≈ 39/40 on substance at ~2.5× the latency; Haiku is faster and cheaper but misses the action
  the funnel exists for. **Founder decides the live model.**
- **2026-10-04** — **Vercel project `sunbnb-app-marketing` created** (via API, admin project as
  template): root `apps/marketing`, `turbo run build`, `npm install --prefix=../..`, Node 24,
  `npx turbo-ignore`, production branch `production`, SSO on all but custom domains, functions
  pinned to fra1 by `apps/marketing/vercel.json`. Env: Maps keys copied server-side from the user
  project per target/branch; `NEXT_PUBLIC_PARTNER_URL` (prod / test branch). Domains:
  `try.sunbnb.app` → production, `trytest.sunbnb.app` → `test` branch,
  `sunbnb-app-marketing.vercel.app` → `main`. First `main` preview READY (SSO-protected).
  Gotchas, each hit once:
  - **API-created git deployments default to the PRODUCTION target regardless of branch**, and
    `target: "preview"` is rejected. One was cancelled before building (only vercel.app aliases
    were attached). Trigger builds by git push, or `vercel redeploy <preview-url>` (keeps target).
  - **`turbo-ignore` skips a build when the app didn't change** — including the very first build
    from an empty commit. Toggled off for the first redeploy, then back on.
  - **`packages/data`'s postinstall runs `prisma generate`, which requires `POSTGRES_URL` to EXIST**
    (`prisma.config.ts` → `env()`), even in an app with no database. Set to an explicit
    placeholder (`…invalid.localhost…/marketing-has-no-db-until-p3`) rather than handing the
    marketing app real DB credentials before it needs them. **P3 must replace it** with the real
    per-branch URLs (test DB for `main`/`test`, prod DB for production), as admin has.
- **2026-10-04** — **P1 + P2 built.** Findings worth keeping:
  - **Google's point for a beach is often NOT on the sand** (Platja de Muro: ~80 m inland in the
    dune forest) and Places says nothing about the sea's direction — a centred, south-facing
    default needed a click plus nine rotate presses. OSM `natural=coastline` ways keep water on
    the RIGHT, so the nearest segment yields waterline + sea bearing directly; both test beaches
    snapped correctly with zero input. Placement mode `waterline` puts row A `waterlineGapM` (6 m;
    12 m pushed back rows into dune vegetation) inland of it.
  - **Overpass is slow and flaky** (0.8 s – 12 s+, mirrors timed out): it is fetched AFTER render
    and fails soft; a prospect's own move/rotate always wins over a late answer (`touched` ref).
    At ad scale it needs the 30-day per-cell cache to respect fair use — watch it in P4.
  - **Map rendering:** one canvas `OverlayView` for all beds, not a marker per bed (track 020's
    lesson); beds drawn true to scale, dots when zoomed out below 2 px.
  - `@vis.gl/react-google-maps` resolves the hoisted `@types/react` 19 while apps are on React 18
    types → re-typed as `FC<Props>` (keeps prop checking) rather than the repo's
    `ComponentType<any>` casts.
  - Q2 answered for now: the layout generator lives in `apps/marketing/lib` (its only consumer);
    it moves to a package when P7 seeds a real site from it.
- **2026-10-04** — **Three-way local comparison** (`--repeat 2`, thinking off, quiet machine):
  qwen3:14b **40/40**, TTFT median 0.21 s, full call p90 3.2 s · mistral-small3.2:24b 33/40,
  call p90 9.2 s (drops tool calls: contact not saved, demo not requested, empty replies) ·
  llama3.1:8b 19/40 (misses prices, Mollie, the no-hardware fact; answered Finnish in
  Spanish; dumped a 300-word reply to the prompt-reveal attack). **Background-work model:
  qwen3:14b.** Bigger was not better: the 24B lost to the 14B on tool use.
  **CORRECTION to the P0 entry below:** the 17 s p90 was measured while ~20 GB of model
  downloads were writing to disk; on a quiet machine qwen3's p90 is 3.2 s. D3 still stands —
  a single-user laptop number says little about a production GPU under concurrent ad
  traffic, and the API removes the inference host from the live path entirely — but the
  slow tail was largely contention, not the model, and should not be cited as the reason.
- **2026-10-04** — D5: `try.sunbnb.app` subdomain, not a Multi-Zones path under the partner
  app — same-origin ad pixels would reach the operator portal's storage and cookies.
- **2026-10-04** — **D3 REVISED to the latency split** (API live, local background) after the
  P0 data and a founder correction: the original intent of "local for privacy and experience"
  was the less-demanding, non-latency-critical work, not the conversation. Recorded so nobody
  re-litigates it from the first wording.
- **2026-10-04** — **P0 findings (qwen3:14b, Ollama, M1 Max 64 GB).** Harness built:
  `lib/agent/{model,fact-sheet,tools,system-prompt,run-turn}.ts` + `eval/{scenarios,scorers,run,summarise}.ts`,
  41 unit tests. Results and what they forced:
  - **Thinking mode is unusable for chat**: TTFT 8.5 s median, one turn 100 s. Sending
    `reasoning_effort: "none"` (Ollama's OpenAI-compatible endpoint honours it) → 0.3 s.
  - **Without thinking, the model completed a garbled email** ("maria at chiringuitosol dot"
    → `maria@chiringuitosol.com`) and saved it — format validation cannot catch an invented
    but valid address. Fixed structurally: contact details must appear in the prospect's own
    text (`groundedIn` in `tools.ts`).
  - **It claimed actions it never took** ("the team will contact you", "I'll let the team
    know") with no `request_demo` call. Added a universal scorer for unbacked promises.
  - **It would not chain `update_lead` → `request_demo` in one turn.** Fixed by letting
    `request_demo` carry the contact fields itself — one call, not two.
  - One generation ran >120 s (degenerate loop) → `max_tokens` 400 cap on every call.
  - After fixes: **60/60** over 3 repeats; TTFT median 0.31 s / p90 6.6 s; full call median
    2.9 s / p90 16.9 s — measured during model downloads; see the correction above.
  - Lesson for the scorers: the first 19/20 pass HID the email guess and the false promise;
    reading transcripts found both. Every new failure seen in a transcript becomes a check.
- **2026-10-04** — D4: agent stays out of the partner landing page; a tagged CTA there links
  into `apps/marketing`. Track flipped to **active**; P0 starting.
- **2026-10-04** — Track created from founder brief. D1 form-first, D2 `apps/marketing`,
  D3 (first wording, since revised) self-hosted model for privacy + hands-on experience. Key design call recorded: the mockup
  is code-generated on real satellite imagery, not AI image generation; the model handles only
  the conversation, and the funnel must survive the model being down. Cost note for the
  record: at landing-page volumes an API-only agent (Haiku + prompt caching) would be roughly
  €5–50/month vs ~€180+/month for an always-on GPU box — D3 is chosen for privacy and
  learning, not cost, and that's fine as long as it's explicit.

## Links

- [[track:023]] — fall-back-never-error doctrine; `BookingSurface` as a reference for a
  self-contained booking demo
- [[track:020]] — large layouts on the map (performance if a prospect enters 1,000 sunbeds)
- [[subsystem:design-system]]
- Partner inventory map: `apps/partner/app/sites/[id]/inventory/`
