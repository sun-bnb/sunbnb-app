---
id: 019-hw-api
title: HW API — device state endpoint + telemetry
status: proposed
created: 2026-08-13
updated: 2026-08-13
worktree: null
---

## Goal

Serve the parasol-mounted hardware device built in the sibling repo `../sunbnb-hw` from this
backend, with **no new infrastructure**: no MQTT broker, no fleet worker, no separate service.
The device is an ESP32-C6 that joins Wi-Fi and does exactly two HTTPS calls against this app:

```
GET  /api/hw/{code}/state       → the seat state its LED bar renders
POST /api/hw/{code}/telemetry   → battery / RSSI / uptime (fire-and-forget)
```

Everything else about the device is hardware's problem. The end state for this track: a device
on a parasol turns **red within ~60 s** of a real reservation on that seat, and turns **green**
when the reservation ends — driven by the same derivation the partner grid uses, never a second
opinion about what a seat's state is.

**Scope is the device↔API link only.** The guest-facing QR path and any unification of the
existing `/pos` seat-state logic are explicitly **parked** (see *Parked*) — this track is the
wire between a device and this backend, nothing else.

**Why it matters:** this is the first API consumer that is not a browser — unauthenticated by
session, battery-constrained, and unable to be redeployed once potted in a box on a beach. The
wire contract is a **long-lived compatibility surface**: freeze it before 1 500 units carry it.

Hardware side of the contract (already decided, `../sunbnb-hw/docs/decisions/`): ADR 0005 LED
semantics · ADR 0007 Wi-Fi via solar 5G nodes · ADR 0008 direct HTTPS polling · ADR 0009 no NFC.
Device LED language: **green breathe = FREE · red pulse = RESERVED · off = OCCUPIED ·
amber = STALE/UNAVAILABLE**.

## Resume here

**P1 is code complete (2026-08-13, uncommitted).** `apps/user/app/api/hw/[code]/state/route.ts`
+ `route.test.ts` (43 tests); user app 521u green, `tsc --noEmit` and lint clean;
`HW_TOKEN`/`HW_DEVICE_MAP` declared in `turbo.json`; route + tests documented in
`apps/user/CLAUDE.md`.

**Next action — bring-up, when the kit lands (no code expected):**

1. Set `HW_TOKEN` (any random string for the demo) and `HW_DEVICE_MAP`
   (`{"<CODE>":["<itemId>","<itemId>"]}`, **array order = LED mount order**) on the test env.
   Pick a real `InventoryItem` pair via `/db`.
2. `curl -H "Authorization: Bearer $HW_TOKEN" https://test.sunbnb.app/api/hw/<CODE>/state` —
   expect `FREE`; make a reservation on that seat; expect `RESERVED` within one poll.
3. Point the device at it (`../sunbnb-hw/docs/build-plan.md` §3 step 3). **Then P1 is done.**

**Then P2** — `Device` + `DeviceSeat` migration per **Binding**, route switches off the env map,
and the wire contract freezes. Q6 (check character) and Q7 (token rotation) must be answered
before that freeze.

**Context needed:** this file · the route + its tests · `packages/data/src/reservation-machine.ts`
(`deriveState`, `CompoundState`) · `apps/partner/app/sites/[id]/manage/bed-state.ts` (the sibling
consumer) · `packages/data/src/site-day.ts` · `../sunbnb-hw/docs/decisions/0008-direct-https.md`.

**Blocked by:** hardware in transit (`../sunbnb-hw/docs/orders/2026-08-build-order.md`). P1 was
the software half of `../sunbnb-hw/docs/build-plan.md` §3 step 2 and gates step 3 ("LED turns red
from across the internet").

## Wire contract (P0 — proposed, freeze before P2)

**`GET /api/hw/{code}/state`** · `Authorization: Bearer <device token>` · `If-None-Match`

```jsonc
{
  "code": "7QK3M2",
  "state": "OCCUPIED",          // aggregate over seats — the simple device reads only this
  "seats": [                    // per-seat, in mount order: a parasol = 2 beds, and the
    { "id": "clx…", "label": "A12", "state": "FREE" },     // LED bar can split left/right
    { "id": "cly…", "label": "A13", "state": "OCCUPIED" }
  ],
  "pollAfterSec": 60,           // server-driven cadence; device obeys, firmware never hardcodes
  "cmd": null,                  // null | "stow" (deep sleep until spring) | "identify"
  "serverTime": "2026-08-13T09:12:04Z"
}
```

**States** (closed set — adding a member is a breaking change for fielded devices):
`FREE` · `RESERVED` · `OCCUPIED` · `UNAVAILABLE`. `STALE` is **device-side only** (no 200 for
N polls) and must never appear in a response.

**Derivation** — from the seat's active reservation today (none / all released ⇒ `FREE`):

| CompoundState | Wire | LED |
|---|---|---|
| no active reservation | `FREE` | green breathe |
| `kind: block` | `UNAVAILABLE` | amber sparse |
| `occ: present` (checked-in / walked-in / comp) | `OCCUPIED` | off |
| `occ: expected` | `RESERVED` | red pulse |
| `occ: departed \| no-show`, `released: false` (mid-stay multiday) | `RESERVED` | red pulse |
| `occ: none` (hold, pending/processing payment) | `RESERVED` | red pulse |
| anything unrecognised | `OCCUPIED` | off |

**Fail-safe direction:** the last row is load-bearing. A wrong `OCCUPIED` costs one unsold
seat-hour; a wrong `FREE` puts two parties on one lounger. Never resolve doubt toward `FREE`.
Errors return non-200 so the device shows amber rather than a confident lie.

**Aggregate rule:** `state` = `FREE` only if every seat is `FREE`; otherwise the most blocking
member (`UNAVAILABLE` > `OCCUPIED` > `RESERVED`).

**Seat order is part of the contract.** `seats[]` is emitted in **binding order** —
`DeviceSeat.position`, where 0 is the leftmost LED segment (P1: the array order in
`HW_DEVICE_MAP`). Position is a *physical mount fact* recorded at install, not a sort over seat
numbers: a device mounted rotated, or a row numbered right-to-left, still lights correctly. The
response must never fall back to an implicit database order. Freeze with the rest of the
contract.

**No enumeration oracle — 401 for everything.** Unknown code and bad token must be
indistinguishable to a caller: same status, same body, no timing tell. The code is printed on a
sticker on a public beach, so treating "this code exists" as free information would let anyone
walk the code space. *(Changed 2026-08-13 from the drafted `404` on unknown code.)*

**`POST /api/hw/{code}/telemetry`** — `{ fw, battMv, rssiDbm, upSec, polls, tempC? }` → `204`.
Last-values only (no time series). Never fails the device's poll loop. Same 401 rule.

## Identity & credentials (decided 2026-08-13)

**`code` and `token` are different things.** The code is *public* — it is printed on the device's
sticker. It authenticates nothing.

**Code — server-issued, random, 6 chars of Crockford base32** (`0-9A-Z` minus `I L O U`), stored
uppercase, input normalised (Crockford folds `i→1`, `o→0`, lowercase→upper):

- **Random, never sequential** — sequential leaks fleet size and invites enumeration.
- **6 chars = 1.07 × 10⁹.** Birthday collision at 1 500 devices ≈ 0.1 %; `@unique` + retry on
  violation settles it. Widen to 8 above ~100 k devices.
- **Crockford alphabet** because a human reads this aloud to support from a windy beach.
- **Short** so the sticker's QR stays a low version — big modules at sticker size still scan at
  arm's length in glare on a wet phone. *(This argument was originally carried by the parked
  guest-QR route; the code stays short anyway — it costs nothing and preserves the option.)*
- Optional 7th **check character** (mod-32, same alphabet) so a mistyped code is rejected rather
  than resolving to a stranger's parasol. Costs one character — **Q6, decide before freeze**.
- **Not derived from the MAC / eFuse ID.** Tempting (zero provisioning) but: 12 hex chars is bad
  on a label and in a QR, it leaks a hardware id into a public identifier, it is enumerable
  within the vendor OUI, and it welds identity to a *board* — replace a dead board and the
  sticker must be reprinted, which server-side binding exists to prevent (`../sunbnb-hw` ADR
  0003). Record the MAC on the `Device` row as a provisioning fingerprint (support,
  anti-theft) — never as identity.

**Token — 32 CSPRNG bytes → base64url (43 chars), stored as sha256 only**, constant-time compare.
Lookup is by `code` from the path, so no index on the hash is needed. *Not* bcrypt/argon2: a
high-entropy random secret has no dictionary to attack, and this comparison runs on every poll
(Q3's ~1.3 M/day) where a slow KDF is a self-inflicted cost problem. Revocation = `status` flip;
rotation is near-moot on a device potted for its service life.

**Minting (P3) — at the bench, not in the field.** Hardware half is decided in
`../sunbnb-hw` ADR 0010; the app-side obligations it creates:

- **Order is mint → flash → print, in one script run**, so the database row, the NVS contents
  and the sticker match *by construction*. The app must therefore expose a **mint** that creates
  the `Device` row and returns `{code, token}` **once** — the token is never readable again.
- **A failed flash leaves an unclaimed row.** Deliberately the safe direction (the reverse would
  leave a live device with no row), but it means `Device.status` needs a real vocabulary —
  `minted → provisioned → active → retired` — not just active/revoked.
- **A board swap re-provisions the *same* `code` and `token`**; the enclosure, sticker and
  binding are untouched. Identity belongs to the installed unit, not to the board. Consequence
  for us: **`macAddr` is mutable** — re-record it on re-provision, and don't lean on it as an
  anti-theft fingerprint, because a legitimate board swap changes it.
- The volume alternative (shared bootstrap secret + claim-on-first-boot, server binds the MAC)
  puts that secret in every firmware image — one recovered device compromises the claim
  endpoint. Revisit only when per-unit flashing becomes the bottleneck.

**Known limitation:** a token in plain NVS is readable by anyone with the board and a USB cable.
ESP32-C6 supports NVS/flash encryption — worth enabling before a real fleet, not urgent now
precisely *because* tokens are per-device: the blast radius of a stolen device is one seat's
state plus fake telemetry.

## Binding (Q1 — DECIDED 2026-08-13: explicit seat list)

**The binding is a physical installation fact; `SunbedGroup` is a booking fact.** They coincide
most of the time and are *allowed* to diverge by definition — a group means "these beds book
together" (double sunbeds, a family cluster), a device covers "these beds are under this shade".
Store the seat list explicitly; do not derive it.

```prisma
model Device {
  id         String       @id @default(cuid())  // surrogate: lets a code be reissued without
  code       String       @unique               //   orphaning telemetry/binding history
  tokenHash  String
  macAddr    String?      // provisioning fingerprint, MUTABLE across board swaps, never identity
  status     String       // minted → provisioned → active → retired
  fw         String?
  lastSeenAt DateTime?
  battMv     Int?
  rssiDbm    Int?
  seats      DeviceSeat[]
}

model DeviceSeat {
  deviceId String
  itemId   String @unique   // a seat is under exactly one device
  position Int              // 0 = leftmost LED segment — MOUNT order, a physical fact
  @@unique([deviceId, position])
}
```

**Rejected: the anchor-seat variant** (`Device.itemId` + expand through the group resolver in
`apps/user/app/sites/[id]/pos/[itemId]/page.tsx:5-58`). It is one FK and it makes regrouping
free, but:

- **It over-scopes wherever grouping ≠ shading.** Four beds grouped for booking under two
  parasols, one device each → *both* devices resolve all four seats; both bars show the same
  aggregate and neither reflects the beds under it.
- **An inventory edit would silently change what a light means.** "Follows automatically" is a
  feature exactly when the group is the parasol and an invisible bug the moment it is not — no
  confirmation, no audit, no operator-visible signal.
- **The "one derivation" argument does not apply.** The device still reads every seat's state
  through `deriveState`, so there is no second opinion where it counts. The binding only answers
  *which seats am I over*, and for that the group resolver is a **proxy** for a physical fact,
  not a shared source of truth. Explicit binding removes the proxy.

**Consequences:**

- **Seat order comes from the binding, not a sort.** `position` is the mount order — a device
  mounted rotated, or a row whose seat numbers do not run left-to-right, is expressed correctly.
  Supersedes the earlier "sort by `InventoryItem.number`" contract line.
- **Rebinding is an explicit operator action** when a parasol's beds change, and a stale binding
  is possible. Accepted: a binding that can go stale *visibly* beats one that changes silently.
- A deleted seat drops one `DeviceSeat` row rather than re-scoping the whole device.

## Roadmap

- **▶ P1 — demo state route. CODE COMPLETE 2026-08-13, awaiting hardware.**
  `apps/user/app/api/hw/[code]/state/route.ts` + 43 route tests (user app 521u green, typecheck
  and lint clean). Env-config binding, real `deriveState` projection, no migration. **Definition
  of done is unchanged and NOT met: a device on the test env lighting red from a real
  reservation** — that needs the kit, which is in transit.
- **☐ P1.5 — telemetry stub** *(optional, ~20 lines, no schema).* `POST /api/hw/{code}/telemetry`
  authenticates like the state route and returns `204` without persisting. The firmware loop does
  **both** calls; the contract says telemetry must never fail the poll loop, so a well-behaved
  device tolerates a 404 — but a stub lets firmware exercise the real shape from day one instead
  of discovering the endpoint at P5. Skip if bring-up goes smoothly without it.
- **☐ P2 — `Device` + `DeviceSeat` schema.** Additive migration per **Binding** above; `status`
  lifecycle (`minted → provisioned → active → retired`); token stored sha256-hashed, never
  readable back. Route switches from the env map to table lookup; `HW_DEVICE_MAP`/`HW_TOKEN`
  deleted. **Freeze the wire contract here** — states, seat order, status codes, and Q6's check
  character. Q6 and Q7 must be answered *before* this phase, not during it.

**Phases 3–5 are the device-management surfaces. They are three different jobs with three
different owners, and conflating them is what the earlier roadmap got wrong.** None is needed for
the demo — one device, one env var, no UI. They become real at the *second and third unit*, the
same threshold `../sunbnb-hw` ADR 0010 sets for the provisioning script.

- **☐ P3 — minting (platform-side, a script, not a UI).** We assemble the devices, so this is
  ours, not the operator's. A CLI that mints the `Device` row, receives `{code, token}` once,
  writes NVS over USB and prints the label — in that order, so the DB row, the NVS contents and
  the sticker match *by construction* (ADR 0010). Keep it a script well past the demo: under
  ~100 units a UI buys nothing and makes the one-shot token harder to handle honestly. Also
  needs the local mint record (code, token, MAC, date) ADR 0010 requires, and the unclaimed-row
  path for a failed flash.
- **☐ P4 — binding (operator-side, a FIELD flow on a phone).** The surface Q1's explicit seat
  list makes necessary. **Not the desktop inventory editor** — binding happens standing at a
  parasol with a device in hand, so it belongs on `/sites/[id]/manage`, which is already
  token-gated, mobile-first and login-free: scan the device's QR → tap the seat(s) on the grid →
  confirm. `position` is captured as mount order, left segment first. **Depends on `cmd:
  "identify"`** to be self-verifying: bind, the bar flashes, staff confirm they tagged the right
  parasol before walking away. At ~750 parasols this loop being fast and one-handed decides
  whether a deployment takes a morning or a week. Rebinding uses the same flow (seat replaced,
  parasol moved); a board swap does **not** — that is a re-provision at the bench (P3), same
  code, sticker and binding untouched (ADR 0003 + 0010).
- **☐ P5 — telemetry persistence + operator health view.** Promote the P1.5 stub to last-values
  writes, then a partner-side list (site → devices: last seen, battery, RSSI, fw) so an operator
  sees a dead device before a guest does. Cell voltage is the one number that predicts a field
  failure.
- **💤 P6 — fleet scale.** Only when a real fleet exists: edge runtime, short-TTL per-site cache,
  `304` discipline, cadence throttling via `pollAfterSec`, `cmd: "stow"` for off-season. See Q3
  for the invocation arithmetic.

## Parked (deliberately out of scope — founder direction 2026-08-13)

Both were in earlier drafts of this track. Neither is needed for a device to talk to this
backend, and both drag in consumer-surface design that shouldn't gate the hardware bring-up.

- **Guest QR entry route.** The drafted `/b/{code}` (`b` = beacon) is dropped along with the
  name. If a device-coded QR route is wanted later it needs a fresh, non-beacon prefix and a
  decision about whether the sticker identifies the *device* or the *seat* — that choice
  determines whether it replaces or supplements today's `/sites/{siteId}/pos/{itemId}` cards.
  Not now.
- **Seat-state derivation unification.** Recorded so the finding isn't lost: there are already
  **three divergent implementations** of "is this seat free today" — `deriveState`
  (`packages/data/src/reservation-machine.ts:108`, canonical), `getAvailability`
  (`apps/user/service/availabilityService.ts:65`, re-implements the rule inline, venue-anchored),
  and the POS page (`apps/user/app/sites/[id]/pos/[itemId]/Reservation.tsx:32-56`, client-side,
  browser midnight, **no status filter at all** — `page.tsx:6` includes `reservations: true`
  unfiltered, so a *canceled* reservation still reads as "not available"). P1 adds a fourth call
  site. The clean fix is one projection in `@repo/data` over `deriveState` that all four consume.
  **Deferred, not denied** — the POS bug is real and deserves its own track.

## Log

- **2026-08-13** — Track created. Scoped from `../sunbnb-hw`, where the device design converged
  over nine ADRs onto "poll this backend directly over HTTPS" (ADR 0008), which deleted the
  entire broker/worker/gateway layer an earlier LoRa design implied. Demo hardware ordered; P1 is
  the critical path to a lit end-to-end demo. Wire contract drafted but **not frozen** — cheap to
  change until devices are potted, expensive after.
- **2026-08-13** — **Q2 decided: per-device sha256-hashed tokens**, and the code/token split
  written up (**Identity & credentials**): public 6-char Crockford-base32 code issued by the
  server, secret 32-byte token, bench provisioning over USB. Rejected: MAC/eFuse-derived codes
  (welds identity to a board, defeating the server-side binding that stops sticker reprints on a
  device swap) and sequential codes (leak fleet size, enumerable).
- **2026-08-13** — **Re-evaluated in the app context; "beacon" naming removed and the track
  renamed** (`019-beacon-api.md` → `019-hw-api.md`). Reasons: the hardware is now a Wi-Fi
  *polling client* with an LED bar (`../sunbnb-hw/docs/build-plan.md` §1), so "beacon" carries a
  broadcast connotation the device doesn't have; and the name had leaked into a **fielded,
  effectively unrenameable** surface (`/api/beacons/…`, `/b/…`, the `Beacon` model). Namespace is
  now `/api/hw/` — it names the *client class*, not the product, so a hardware or branding pivot
  never touches a potted URL. The product name stays free to float in `../sunbnb-hw`. Also
  decided: **uniform 401** (the drafted 401-vs-404 split was an enumeration oracle against a code
  printed on a public beach) and **seat order frozen into the contract** (no ordering column on
  `SunbedGroup.items`, so the LED bar's left/right could otherwise flip on a query-plan change).
  Scope narrowed to the device↔API link: guest QR entry and seat-state unification **parked**
  (see *Parked*), with the POS derivation bug recorded there for a future track.
- **2026-08-13** — **Cross-repo reconciled.** `../sunbnb-hw` adopted the rename (`device`
  technically, "sunbed traffic light" in human-facing text) and `/api/hw/{code}` throughout, and
  added **ADR 0010 — device identity is server-minted and flashed to NVS, one firmware binary
  fleet-wide**, which names this track as its normative contract. Folded back: the mint returns
  `{code, token}` exactly once in a mint→flash→print run; `Device.status` needs a real lifecycle
  because a failed flash leaves an unclaimed row (the safe direction); **a board swap
  re-provisions the same code**, so identity belongs to the installed unit rather than the board
  and `macAddr` is therefore mutable — re-record on re-provision, don't lean on it as an
  anti-theft fingerprint. Q7 gained a hard deadline (before the first enclosure is sealed).

- **2026-08-13** — **Q1 decided (explicit seat list) and P1 built.** Route + 43 tests, user app
  521u green. One correctness finding worth keeping: the route must **not** fall back to
  `Reservation.operationalStatus` when today's `ReservationDay` row is absent. The manage page
  never meets this because it lazy-upserts the row (`resolveTodayRow`), but a device polls long
  before staff open the grid — and at 1 500 devices × 60 s an upsert-on-read would be ~1.3 M
  writes/day. So the route mirrors what `resolveTodayRow` *would* create, read-only: walk-ins and
  comps track the parent; every per-day-cycling kind starts a fresh civil day as `expected`.
  Without it a multiday guest who checked in yesterday and has not arrived today reads
  `checked-in` → `OCCUPIED` (dark) when the truth is `expected` → `RESERVED` (red). Both are
  non-FREE, so the fail-safe held either way — but the light would have been wrong.

- **2026-08-13** — **Roadmap restructured around device management.** The old P2 ended at "route
  switches to table lookup", which quietly assumed binding rows appear by magic, and the old P4
  conflated *minting* with *binding* — two jobs with different owners, different homes and
  different timing. Now split: **P3 minting** (platform-side, a bench *script*, not a UI — we
  assemble the devices, and under ~100 units a UI buys nothing while making the one-shot token
  harder to handle honestly), **P4 binding** (operator-side, a *field* flow on
  `/sites/[id]/manage` — already token-gated, mobile-first, login-free — because binding happens
  standing at a parasol with a device in hand, not at a desk in the inventory editor; depends on
  `cmd: "identify"` to be self-verifying), **P5 telemetry + health**. Added optional **P1.5
  telemetry stub** so firmware can exercise both endpoints during bring-up. Noting the honest
  cost of Q1: the explicit seat list is what makes a binding *surface* necessary at all — the
  rejected anchor-seat variant would have been one field on a form. None of P3–P5 is needed for
  the demo; they become real at the second and third unit.

## Open decisions

- **~~Q1 — Binding shape.~~ DECIDED 2026-08-13: explicit seat list** (`DeviceSeat` join table,
  `position` = mount order). The binding is a physical installation fact and `SunbedGroup` is a
  booking fact; deriving one from the other over-scopes wherever grouping ≠ shading and lets an
  inventory edit silently change what a light means. Full reasoning in **Binding**.
- **~~Q2 — Token per device or per site?~~ DECIDED 2026-08-13: per device, sha256-hashed.**
  Per-site is one env var and no provisioning, but a single recovered device would compromise a
  whole beach — and per-device tokens are what keep a stolen device's blast radius at one seat,
  which is also why plain-NVS storage is tolerable for now. Costs P3 minting.
- **Q3 — Fleet invocation cost.** 1 500 devices × 60 s over a 14 h day ≈ **1.3 M invocations/day**
  against a Vercel function that queries Postgres. Irrelevant at demo scale (1 device), decisive
  at fleet scale. Options: edge + short-TTL site cache · `304` (device already sends
  `If-None-Match`) · state-aware cadence (fast only while `FREE` in opening hours, ADR 0006) · a
  per-site batch endpoint. Decide **before** the first paying operator, not before P1.
- **Q4 — `Site.timeZone` is a dead column** (track 017: never written). The device needs the
  venue's civil day. P1 falls back the way `site-day.ts` already does; P2 should depend on 017's
  P7 populating it rather than inventing a second fallback.
- **Q5 — Does the device get a *write* path?** Currently read-only + telemetry. A "reserve from
  the bed" button would need one; deliberately out of scope.
- **Q6 — Check character in the code, yes or no?** One extra character buys rejection of a
  mistyped code instead of resolution to a stranger's parasol. Only matters where a human types
  or reads a code aloud (support calls, provisioning). Decide **before freeze** — it is a wire
  fact, not an implementation detail.
- **Q7 — Can a device accept a new token over the wire?** (e.g. via `cmd`.) If not, a compromised
  fleet is a field visit per unit. Trivial to add to the contract now, impossible after potting —
  **deadline: before the first enclosure is sealed** (`../sunbnb-hw` ADR 0010 consequences).

## Links

- [[track:018-reservation-state-machine]] — the derivation this route must reuse; `deriveState`
  is the single-derivation contract, and a device that re-implements it re-opens B1-class bugs
- [[track:017-venue-timezone-anchoring]] — Q4; this route is a new reader of "today"
- [[track:012-multiday-per-day-operational-state]] — why mid-stay `departed` is not `FREE`
- [[subsystem:reservation-state-machine]]
- Sibling repo `../sunbnb-hw` — **this track is the normative contract for the wire, the code
  and token formats, and the `Device` model; the ADRs there own the hardware half**:
  `docs/decisions/0010-device-identity-provisioning.md` (server mints, one firmware binary,
  identity in NVS, mint→flash→print) · `docs/decisions/0008-direct-https.md` (why polling, why no
  broker; carries the uniform-401 amendment) · `docs/decisions/0003-rendered-qr-with-label-backup.md`
  (server-side binding, why a swap must not reprint) · `docs/decisions/0005-indicator-architecture.md`
  (LED semantics) · `docs/build-plan.md` (build order + cost) · `docs/demo-setup.md` (device
  firmware loop) · `docs/orders/2026-08-build-order.md` (what is in transit)
