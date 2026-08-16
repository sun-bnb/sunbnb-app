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

**P1 committed** (`cbb251b`, `42a6b18`); **P1.5 + Q9 filter swap committed** (`b006d21`, docs
`cccd275`); **P2 built 2026-08-16 (uncommitted).**

Two routes — `state/route.ts` (+ `projection.ts`, 49 tests) and `telemetry/route.ts` (13 tests,
stub: persists nothing) — share ONE request gate, `hw-filter.ts` `screenDeviceRequest`, so they
cannot drift. **The gate is a soft `User-Agent` client filter, not auth** (Q9): `HW_CLIENT_UA`
holds an opaque needle, matched with CONTAINS so a firmware version bump needs no server change;
unset fails CLOSED (503). No token anywhere. **The binding is now the `Device`/`DeviceSeat` tables**
(P2, migration `20260816045431_add_hw_device_binding`, additive, applied local + `sunbnb_test`);
`HW_TOKEN` and `HW_DEVICE_MAP` are both gone, `HW_CLIENT_UA` is the only env var in `turbo.json`.
User 538u + 102i, data 360u + 350i, partner 2002u, admin 174u, `tsc` + lint clean; `migrate:check`
reports no drift.

**USER OPS before any `main` push:** `cd packages/data && npm run migrate:test` — the shared test DB
needs this additive migration before main's preview runs against it (the pre-push hook enforces it).

**▶ REVISED PLAN 2026-08-16 — server work first, hardware only at the end.** The binding
model changed (see the block above), so the phase order changed with it. Full cross-track
ordering lives in [[track:021]] *Delivery sequence*; this track owns steps 3, 4 and 6:

- **P5a — Device model + telemetry persistence (NEXT here, no hardware needed).** Promote the
  P1.5 stub to last-values writes: `fw`, `lastSeenAt`, `battMv`, `rssiDbm`, plus the location
  the device reports it is RUNNING. Add the assignment columns the UI writes. Additive
  migration. A device self-registers on its first poll, which is what makes the fleet list
  possible at all.
- **P5b — Fleet UI (partner).** One list per customer: code, assigned location, applied
  location, last seen, battery, RSSI. The reconciliation states fall out of the data —
  polling-but-unassigned · assigned-but-never-applied · silent >24 h · spots with no device.
- **P4 — Assignment (no longer a QR field flow).** Assign/reassign a location from that list;
  the state response carries it inside the hashed `stable` object; `cmd: "identify"` confirms
  the right device before anyone walks away. State resolution moves from `DeviceSeat` to
  "the unit at the assigned location", with the hard rule that an assigned location with **no
  unit** reads amber, never FREE.
- **Freeze + bring-up (needs the kit).** Only after a real device has run the contract. The
  cross-repo obligations then are: the 6-char code in every request path, the customer number
  flashed permanently, config applied idempotently from the poll response, and the reported
  location returned in telemetry.

**Original bring-up note (still valid for the first unit):**

1. Set `HW_CLIENT_UA` (the opaque needle, e.g. `k3n8fq2p` — must match what the firmware sends
   inside its `User-Agent`) on the test env. Then INSERT a `Device` row (any 6-char Crockford code,
   `status: 'provisioned'` or `'active'`) plus one `DeviceSeat` per bound seat with `position` 0,1…
   in **LED mount order** — pick a real `InventoryItem` pair via `/db`. (P3 automates this; by hand
   is fine for one unit.)
2. `curl -H "User-Agent: Sunbnb-Sensor/1 ($HW_CLIENT_UA)" https://test.sunbnb.app/api/hw/<CODE>/state`
   — expect `FREE`; make a reservation on that seat; expect `RESERVED` within one poll.
3. Point the device at it (`../sunbnb-hw/docs/build-plan.md` §3 step 3). **Then P1 is done.**

**Cross-repo obligation:** `../sunbnb-hw` must send the agreed `User-Agent`
(`Sunbnb-Sensor/1 (<needle>)`) and must NOT send an `Authorization` header — the token model is
gone (Q9). ADR 0010 (server-minted per-device token, mint→flash→print) is **superseded** on the
credential half and needs amending there; the `code` half still stands.

**P2 is built** (see Roadmap): the binding now lives in the `Device`/`DeviceSeat` tables and
`HW_DEVICE_MAP` is gone. **The wire contract is deliberately NOT frozen** — that half of P2 waits
until a real device has exercised it at bring-up. Freeze right after step 3 below succeeds.

**⚠ BINDING MODEL REPLACED 2026-08-16 — see [[track:021]] P5.** Settled shape: a device
**self-registers on first poll** and appears in the partner's fleet list; the partner assigns
a **seat code (location)** from the UI; the assignment is returned in the **telemetry
response** and the device stores it. Not a seat list, not a unit id, and not an address baked
into firmware. Consequences for this track:
- **P5 (telemetry persistence) is now a PREREQUISITE, not a follow-up** — the stub persists
  nothing, and the fleet list is what the assignment UI renders.
- **P4 is no longer a QR-scanning field flow.** Devices announce themselves; assignment is a
  UI action, confirmed by the identify flash.
- **Wire contract:** **config rides the STATE (poll) response** (decided 2026-08-16) — put
  the assigned location inside the hashed `stable` object, so a change busts the ETag and is
  delivered on the next poll while an unchanged assignment keeps 304ing. The poll is the fast
  channel and happens anyway; telemetry is battery-constrained and would make assignment a
  wait-and-hope flow. **Telemetry gains the reverse direction instead**: the device reports the
  location it is actually running, so the UI can separate ASSIGNED from APPLIED. Delivery is DECLARATIVE: the assignment is in every `200` body (an unchanged
  response is a bare `304`, so it is free), which makes it self-healing — a rebooted, swapped
  or out-of-range device converges on its next `200` with no ack protocol. Firmware must apply
  it idempotently: the same value arrives repeatedly, so write NVS only when it differs. Decide before the flash/print run — after 1 500 units carry it, it
  is expensive. The `state` URL key **stays the device code**: the URL is potted, so keying it
  by a reassignable location would leave a reassigned device 401ing or serving a stale spot.
- **`DeviceSeat` as an explicit seat list is superseded**; segment order derives from the
  unit at the assigned location.
- **Flashing model decided 2026-08-16.** PERMANENT at the bench: the 6-char device code (the
  identity in every `state` and `telemetry` request — so **the fielded URL shape does not
  change at all**) plus the customer number (which partner's fleet it joins; a return means a
  bulk reflash, accepted). PROGRAMMABLE by the server: site · parcel · row · position. The
  code stays in the URL rather than the location precisely because a device must remain
  reachable when its location is WRONG — otherwise it is unfixable exactly when it needs
  fixing. Net effect on this track: **the two routes keep their shape; only the telemetry
  RESPONSE gains a body, and `Device` gains assignment + last-values columns.**

**⚠ Q1 SUPERSEDED 2026-08-16 by [[track:021]].** Q1 decided the binding is an explicit **seat**
list because "the binding is a *physical installation* fact and `SunbedGroup` is a *booking* fact".
That reasoning was right under the model as it stood. Track 021 removes its premise: units become
universal and selling policy moves to parameters, so `SunbedGroup` *becomes* the physical mount
point and the device binds to it. **P4 (the field binding flow) should not be built before 021 P4**
— building it on seat bindings means re-binding every installed unit later. P1/P1.5/P2/P3 as shipped
are unaffected: the wire contract, the code rules and the provisioning script all stand.

**Context needed:** this file · the route + its tests · `packages/data/src/reservation-machine.ts`
(`deriveState`, `CompoundState`) · `apps/partner/app/sites/[id]/manage/bed-state.ts` (the sibling
consumer) · `packages/data/src/site-day.ts` · `../sunbnb-hw/docs/decisions/0008-direct-https.md`.

**Blocked by:** hardware in transit (`../sunbnb-hw/docs/orders/2026-08-build-order.md`). P1 was
the software half of `../sunbnb-hw/docs/build-plan.md` §3 step 2 and gates step 3 ("LED turns red
from across the internet").

## Wire contract (P0 — proposed, NOT frozen; freeze right after bring-up)

**`GET /api/hw/{code}/state`** · `User-Agent: <configured sensor value>` · `If-None-Match`

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

**`cmd` is a closed set — firmware must recognise every member before potting.** A member
the firmware does not understand is ignored *forever* on a sealed unit, so the set freezes with
the rest of the contract, immediately after bring-up. There is **no `rotateToken`** (Q7 reversed 2026-08-16): the
request carries no secret to rotate — see **Client filter (Q9)**.

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
response must never fall back to an implicit database order. The route asks for
`orderBy: { position: 'asc' }` and a test asserts that query shape, because an implicit order is
exactly the kind of thing a later refactor drops silently. Freeze with the rest of the contract.

**Uniform rejection.** A request that fails the client filter or names an unknown code returns the
same response — same status, same body, no timing tell. Under the Q9 soft-filter model this is no
longer an *enumeration-oracle* defence (there is no secret to protect and the code is public
anyway); it is kept only because a uniform, opaque reject is the tidy default and the P1 code
already does it. The status is `401` today; `403`/`404` would be equally fine for a filter — not a
frozen wire fact.

**`POST /api/hw/{code}/telemetry`** — `{ fw, battMv, rssiDbm, upSec, polls, tempC? }` → `204`.
Last-values only (no time series). Never fails the device's poll loop. Same client filter.

## Identity & client filter (code decided 2026-08-13; credential model → soft filter 2026-08-16, Q9)

**There is no secret and no authentication.** The `code` is *public* routing (printed on the
sticker, says *which* device is calling); the only gate is a **soft client filter** — a custom
`User-Agent` value that says "I am the sensor firmware" and lets the server decline obviously
non-sensor traffic. Neither authenticates anything. Full reasoning: **Client filter (Q9)** below.

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

**Client filter — a custom `User-Agent` value (Q9, DECIDED 2026-08-16: soft filter, no secret).**
The endpoint's only gate is that the request's `User-Agent` contains a configured sensor value,
e.g. `Sunbnb-Sensor/1 (k3n8fq2p)` — a readable product tag (nice in logs) plus a short opaque
suffix so a generic scanner (`curl`, `python-requests`, empty UA, a browser) never matches by luck.
Checked **before the DB query**, so junk traffic is rejected cheaply. This is **obscurity, not
authentication** — and deliberately so: the asset is not worth attacking (see Q8/Q9), so a filter
that declines *obvious* non-sensor traffic is the proportionate design, and paying for real
credentials, hashing, rotation or per-device secrets would be defending an adversary who won't come.

- **Why `User-Agent` and not a bespoke header.** It is the one standard header whose literal job is
  identifying the client, the device sends it anyway (zero extra bytes), and it is never stripped by
  infra — where a custom `X-` header occasionally is. The device talks straight to Vercel over
  HTTPS, so there is no proxy to mangle it.
- **The one residual risk is cost-abuse, not data.** If the value leaks (it is extractable from any
  device's firmware) someone could *flood* the DB-hitting endpoint to run up serverless cost. The
  filter cannot stop a flooder who has the value — **the backstop is Vercel edge rate-limiting**, a
  server-side lever that needs no device involvement. This is why there is **no OTA rotation** (Q7
  reversed): rotation only earned its keep while the value was a secret; edge throttling is the
  better abuse lever once it isn't.
- **Config, not schema.** The expected value is a single env var (`HW_CLIENT_UA` or similar) read by
  the shared `hw-filter.ts` gate — no config row, no `tokenHash`, no dual-valid window. Same value
  on every unit.

**Provisioning (P3) — at the bench, trivial under Q9.** No secret at all: **assign a unique `code`,
flash firmware carrying the shared `User-Agent` value, print the sticker.** The UA value is the same
on every unit and is not device-identifying, so there is no one-shot handling. A failed flash leaves
an unprovisioned row (the safe direction; `Device.status` keeps `provisioned → active → retired`). A
board swap re-flashes the *same* `code`; `macAddr` is mutable — re-record on swap, never identity.

**Known limitation (accepted):** the `User-Agent` value is extractable from any device's firmware,
so it is not secret and cannot be — that is the point of calling it a *filter*, not a credential.
The exposure it accepts is cost-abuse (covered by edge rate-limiting), never a data breach, because
there is no data of value behind it. NVS/flash encryption raises the bar to extraction but changes
nothing about the model.

**Code — server-issued, random, 6 chars of Crockford base32.** Unchanged by Q9: it is public
routing to the seat binding, not a credential. Details in the **Code** subsection above (Q6: no
check character).

## Binding (Q1 — DECIDED 2026-08-13: explicit seat list)

**The binding is a physical installation fact; `SunbedGroup` is a booking fact.** They coincide
most of the time and are *allowed* to diverge by definition — a group means "these beds book
together" (double sunbeds, a family cluster), a device covers "these beds are under this shade".
Store the seat list explicitly; do not derive it.

```prisma
model Device {
  id         String       @id @default(cuid())  // surrogate: lets a code be reissued without
  code       String       @unique               //   orphaning telemetry/binding history
  // No token/secret at all (Q9): the only gate is a soft `User-Agent` filter read from env by
  // hw-filter.ts — nothing per-device to store here.
  macAddr    String?      // provisioning fingerprint, MUTABLE across board swaps, never identity
  status     String       // provisioned → active → retired
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
- **▶ P1.5 — telemetry stub. BUILT 2026-08-16 (uncommitted), no schema.** `POST
  /api/hw/{code}/telemetry` passes the shared request gate and returns `204` without persisting —
  a malformed/absent body is still `204` (telemetry must never fail the device's loop). 11 tests.
  Landed with a refactor: the state route's inline gate (env binding, `normalizeCode`) moved to a
  shared module so both endpoints screen requests identically; the state tests reran green as the
  safety net. P5 promotes this stub to last-values writes.
  **Q9 swap applied 2026-08-16:** the shared module is now `hw-filter.ts` / `screenDeviceRequest`
  (renamed from `hw-auth.ts` / `authenticateDevice` — "auth" would misdescribe a filter), checking
  `User-Agent` CONTAINS `HW_CLIENT_UA` instead of `Bearer HW_TOKEN`; unset config fails CLOSED
  (503) so it can never silently open. `HW_TOKEN` deleted from `turbo.json`. Both routes inherited
  it; user app 533u green, tsc + lint clean.
- **▶ P2 — `Device` + `DeviceSeat` schema. BUILT 2026-08-16 (uncommitted).** Additive migration
  `20260816045431_add_hw_device_binding` (two CREATE TABLEs, three indexes, two cascading FKs — no
  DROP, no change to any existing column) applied to local + `sunbnb_test`; `migrate:check` clean.
  `status` lifecycle `provisioned → active → retired`; **no token or secret column** (Q9). The route
  reads its binding from the tables via `hw-filter.ts` (`HW_DEVICE_MAP` deleted from code and
  `turbo.json`); the wire contract did not change when the source moved. Three decisions taken while
  building, worth not re-deriving: **`provisioned` serves** (requiring `active` would trap bring-up
  behind a manual status flip, and the fail-safe holds either way — a declined device shows amber);
  **a device with zero bound seats is declined**, because an empty seat array would aggregate to
  `FREE`, the one answer that must never be invented; and **a failed binding lookup is 503, not the
  uniform decline**, so a DB outage cannot read as "unknown device". User 538u + 102i, data 360u +
  350i, partner 2002u, admin 174u green.
  **NOT frozen yet — deliberately.** The wire contract freeze was the other half of this phase and is
  held until hardware bring-up has actually exercised it: freezing before any real device has ever
  spoken to the API would freeze in whatever the first device turns out to disagree with. Freeze
  immediately after a device lights red from a real reservation.

**Phases 3–5 are the device-management surfaces. They are three different jobs with three
different owners, and conflating them is what the earlier roadmap got wrong.** None is needed for
the demo — one device, one env var, no UI. They become real at the *second and third unit*, the
same threshold `../sunbnb-hw` ADR 0010 sets for the provisioning script.

- **▶ P3 — provisioning. APP-SIDE HALF BUILT 2026-08-16 (uncommitted).**
  `packages/data/scripts/provision-device.ts` + `npm run device:provision[:test|:production]`
  creates the `Device` row and its `DeviceSeat` binding and prints the code for the sticker;
  `packages/data/src/device-code.ts` (exported `@repo/data/device-code`, 14 unit tests) owns the
  code rules. **The route now re-exports `normalizeDeviceCode` instead of keeping its own copy** —
  minting and lookup sit on opposite sides of a sticker glued to a potted device, so a code minted
  under different folding rules than the route normalises by is permanently unreachable; the
  round-trip test is the guard. Validates before writing (unknown ids · seats spanning >1 site,
  which the state route rejects · seats already under another device), because each of those
  otherwise surfaces in the field as a silent amber LED. **Exercised against the real dev DB**:
  cross-site binding refused, dry-run, a real provision (`NWJMDB`, 2 seats in mount order, MAC
  recorded), double-bind refused, and the minted code re-resolved through the route's exact query in
  three spellings (`NWJMDB` / `nwjmdb` / padded) — mint↔lookup agreement proven before any hardware
  exists. Test rows deleted afterwards (the cascade took the `DeviceSeat` rows with them, confirming
  the FK).
  **Remaining for P3 (hardware-side, `../sunbnb-hw`):** flashing the firmware over USB and printing
  the label in the same run, so DB row / NVS / sticker match by construction (ADR 0010).
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
  and the POS page (client-side, browser midnight, **no status filter at all**). P1 adds a fourth
  call site. The clean fix is one projection in `@repo/data` over `deriveState` that all four
  consume. **Still deferred** — but see below: the POS half is now fixed.

  **✅ The POS bug is FIXED (2026-08-16), one implementation retired.** The POS page no longer
  derives availability at all: `pos/[itemId]/queries.ts` (`getPosContext`) decides it server-side
  through the canonical `getAvailabilityForItems` and ships `availableItemIds`; the client-side
  `isItemAvailableToday` and the unfiltered `reservations` include are deleted. Fixes canceled /
  refunded / payment_failed bookings blocking a seat permanently from its own QR code, adds the
  track-012 release rule, and anchors "today" to the venue civil day instead of the browser's
  (track 017). 14 integration tests, **6 of which fail on the pre-fix algorithm** (verified by
  running them against it). Divergent implementations: 4 → 3. The remaining unification
  (`getAvailability` ↔ `deriveState`) is untouched and still deserves its own track.

  *Adjacent finding, NOT fixed:* the parent `/sites/[id]/pos` route (`page.tsx:11`) fetches
  `reservations` for **every seat**, unfiltered — and never uses them. Dead payload on a public
  page (a track-020-class concern, not correctness).

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

- **2026-08-16** — **P1.5 telemetry stub built, and the device authenticator extracted.**
  `POST /api/hw/{code}/telemetry` → `204`, persists nothing (P5's job); auth is the shared
  `authenticateDevice` in the new `apps/user/app/api/hw/[code]/hw-auth.ts`, which now owns the
  uniform-401 rule, the constant-time bearer compare, the `HW_DEVICE_MAP` binding lookup and
  `normalizeCode` (moved out of `state/projection.ts`, keeping projection purely about state
  derivation). The state route was refactored onto the same authenticator so the two endpoints
  cannot drift — the 43 state tests are the regression net and reran green. Telemetry adds 11
  tests: uniform-401 parity (unknown code byte-identical to bad token), HW_TOKEN-unset → 503,
  and a `204` that never depends on the body (malformed / empty / unknown-field payloads all
  accepted — telemetry must never fail the poll loop). HW suite 54 green, tsc + lint clean.
  Corrected the stale "P1 uncommitted" note: P1 landed in `cbb251b` + `42a6b18`.

- **2026-08-16** — **Q6 and Q7 decided; the two pre-freeze wire facts are now settled.** **Q6:
  no check character** — the code stays 6-char plain Crockford; a mistyped code fails the token
  check anyway (the code authenticates nothing), so the check digit was buying rejection the token
  layer already provides. **Q7: include OTA token rotation** — `cmd: "rotateToken"` reserved in the
  frozen `cmd` set, two-phase dual-valid semantics (`Device.tokenHashNext` holds the pending hash;
  the device acks by authenticating on the new token; old retired then; idempotent, so a mid-write
  power loss re-sees the command instead of locking the device out), new secret fetched via a
  dedicated authenticated call rather than inline in the ETag'd state body. Rationale: a leaked
  per-device token (plain NVS is USB-readable) must be replaceable without a truck roll; reserving
  the `cmd` shape costs a few lines of firmware now and is impossible to add after potting, while
  the server side can wait for P5/P6. Firmware must handle the command before the first enclosure
  is sealed (`../sunbnb-hw` ADR 0010). With both answered, **P2 is unblocked to freeze the wire
  contract.**

- **2026-08-16** — **Q8 decided: ONE system-wide OTA-able token, reversing Q2's per-device call.**
  Prompted by challenging *why the API needs auth at all*. Conclusion: the read data is low-value
  (occupancy is already public via `/api/sites/[id]/availability` and physically visible on the
  beach), so auth is justified by the **write path** (telemetry integrity) and cost control, not by
  data secrecy. Per-device tokens buy only self-scoped speech, single-unit revocation, and
  per-device future authority — none worth the P3 bench-minting + per-device secret bookkeeping to
  guard that data. So: one shared token, hashed, **OTA-rotatable** (Q7) so a leak is re-keyed from
  the server without a truck roll — rotation is what makes the shared token acceptable. Consequences
  folded through: `Device` loses `tokenHash`/`tokenHashNext` (token → config singleton with a
  dual-valid rotation window); P3 collapses to assign-code / flash-shared-token / print; the
  known-limitation note flips (a recovered device now leaks the *fleet's* token, accepted trade).
  Note: P1's `HW_TOKEN` is *already* a single shared token, so P1 needs no change — this only reshapes
  P2/P3. Left open (P5): the telemetry payload carries `upSec`/`polls`/`tempC` with no `Device`
  columns yet — persist or accept-and-drop is a P5 call, not a freeze-now one.

- **2026-08-16** — **Q9 decided: no credential at all — a soft `User-Agent` filter — reversing Q7
  and hollowing out Q2/Q8.** The security model converged over the day (per-device token → shared
  OTA-able token → shared token, no rotation → **no token**). Final reasoning: auth was only ever
  justified by the *write* path and cost control, not data secrecy (occupancy is already public); and
  the asset is not worth an attacker's time, the damage is non-permanent, and there is zero financial
  consequence — so a *secret* is over-built. The gate becomes a configured `User-Agent` value
  (`Sunbnb-Sensor/1 (…opaque…)`) checked pre-DB to decline obvious non-sensor traffic; the one
  residual risk (a leaked value used to *flood* the DB-hitting endpoint) is covered by Vercel edge
  rate-limiting, not by device-side rotation — which is why `rotateToken` is removed from the `cmd`
  set and Q7 is reversed. Chose `User-Agent` over a bespoke `X-` header: it is the standard client-id
  header, always sent, never stripped. Consequences folded through the contract: `cmd` back to
  `null | stow | identify`; the "enumeration-oracle" framing of the uniform reject retired (kept only
  as a tidy default); `Device` has no token field; P2 loses the whole token-config layer; P3 becomes
  assign-code / flash-firmware / print. *(Code follow-up was noted here as pending; it shipped the
  same day — see the next entry.)*

- **2026-08-16** — **Q9 implemented.** `hw-auth.ts` → **`hw-filter.ts`**, `authenticateDevice` →
  **`screenDeviceRequest`** (the old names would misdescribe a filter as authentication, which is
  exactly the confusion Q9 exists to prevent). The gate is now `User-Agent` **CONTAINS**
  `HW_CLIENT_UA`; `HW_TOKEN` deleted from `turbo.json` and the code. Two choices worth recording:
  **(1) contains, not equality** — config holds only an opaque needle (`k3n8fq2p`) while firmware
  sends `Sunbnb-Sensor/1 (k3n8fq2p)`, so a `/1`→`/2` bump never needs a server change; matching the
  full UA would weld the firmware version into server config, the one thing a potted fleet cannot
  afford. **(2) unset config fails CLOSED (503)**, never open — a missing env var must not silently
  turn the filter off. Tests reframed from "auth" to filter semantics: real scanner UAs (`curl`,
  `python-requests`, a browser) are declined, a version-bumped sensor UA passes, and *neither* a
  filtered request nor an unknown code reaches the DB (the filter's actual job — junk costs a string
  compare, not a Postgres round-trip). User app **533u green** (HW 55: 44 state + 11 telemetry), tsc
  + lint clean. **Cross-repo:** `../sunbnb-hw` must now send that `User-Agent` and no
  `Authorization` header; ADR 0010's credential half is superseded and needs amending there.

- **2026-08-16** — **P2 built: the binding moved from env config to the `Device`/`DeviceSeat`
  tables.** Additive migration `20260816045431_add_hw_device_binding` — two CREATE TABLEs, three
  indexes, two cascading FKs, nothing touched on an existing column, so it satisfies expand/contract
  by construction. No token column: Q9 had already removed the secret, which is most of why this
  phase was small. `hw-filter.ts` gained the lookup (and became async); both routes inherited it
  unchanged, which is the payoff for having extracted the shared gate in P1.5.

  Three judgement calls made while building, recorded so they are not silently reversed:
  **`provisioned` devices SERVE** — gating on `active` would have trapped bring-up behind a manual
  status flip for no safety gain, since a declined device shows amber either way; **a device with
  zero bound seats is declined**, because an empty `seats[]` aggregates to `FREE` and inventing a
  FREE is the one failure this contract forbids; and **a failed binding lookup returns 503, not the
  uniform decline**, so a DB outage cannot masquerade as "unknown device".

  Caught by the meta-guards, worth noting as evidence they earn their keep: partner's
  `mock-contract.test.ts` failed the moment the schema gained models the partner Prisma mock did not
  stub — a class of drift that otherwise surfaces as tests silently skipping code paths months later.

  **The wire contract was NOT frozen**, though P2 was scoped to freeze it. Freezing before any real
  device has spoken to the API would freeze in whatever the first device turns out to disagree with,
  and bring-up is precisely the event that would expose it. The freeze is now the step immediately
  after "LED turns red from a real reservation". Everything else in P2 shipped.

- **2026-08-16** — **P3's app-side half built: `device-code.ts` + a provisioning script.** Bring-up
  otherwise needed hand-written SQL to invent a code and bind seats in the right order, which is
  exactly the kind of thing that is wrong once and then glued to a parasol. Two things worth keeping:
  **(1) the duplicate normalisation was collapsed** — the route's `normalizeCode` is now a re-export
  of `@repo/data/device-code`'s, because minting and lookup must fold a code identically or the
  device is unreachable with the sticker already attached; the `normalize(generate()) === generate()`
  round trip is the test that guards it. **(2) the script validates before writing** — cross-site
  bindings (which the state route rejects outright), unknown seat ids, and seats already under
  another device are all refused at the bench, since every one of them would otherwise be diagnosed
  by someone standing at a parasol looking at an amber LED. Generation uses a CSPRNG with a 5-bit
  mask rather than `% 32` (256 is a multiple of 32, so no bias) and is random, never sequential,
  which would leak fleet size to anyone reading two stickers. Verified end-to-end against the dev DB
  including the mint↔lookup round trip; test rows cleaned up. data 374u.

## Open decisions

- **~~Q1 — Binding shape.~~ DECIDED 2026-08-13: explicit seat list** (`DeviceSeat` join table,
  `position` = mount order). The binding is a physical installation fact and `SunbedGroup` is a
  booking fact; deriving one from the other over-scopes wherever grouping ≠ shading and lets an
  inventory edit silently change what a light means. Full reasoning in **Binding**.
- **~~Q2 — Token per device or per site?~~ DECIDED 2026-08-13: per device — SUPERSEDED by Q8
  (2026-08-16).** The original call optimised for blast radius (a stolen device compromises only
  itself). Q8 reversed it: for occupancy + telemetry the data is too low-value to justify the
  per-device cost (P3 minting, per-device secret bookkeeping), and OTA rotation makes the
  shared-token leak remediable without a field visit. See Q8.
- **~~Q8 — Is per-device auth worth P3 + Q7, or is a shared token enough?~~ DECIDED 2026-08-16:
  ONE system-wide, OTA-able token.** Auth is justified by the *write* path (telemetry) and cost
  control, not by data secrecy — the read data is already public and physically visible. Given
  that, per-device tokens buy only (a) a device speaking solely for itself, (b) single-unit
  revocation, and (c) per-device future authority — none of which clears the bar to guard one
  seat's public-ish state plus fake telemetry. A single shared token, **rotatable OTA** (Q7) so a
  leak is re-keyed from the server rather than by a truck roll, is enough. Deletes most of P3
  (no per-device minting), moves the token to a config singleton with a dual-valid rotation window,
  and removes the per-device `tokenHash`/`tokenHashNext` from the `Device` model.
  **Reconsidered 2026-08-16** against per-device's one real edge — a leak rotates *one* device, not
  the fleet — and held: OTA flattens the per-rotation cost, so per-device would only reduce rotation
  *frequency*, and the deciding factor is **threat value, not blast radius**. **Then superseded the
  same day by Q9**, which carried the same threat-value logic one step further — if the asset isn't
  worth attacking, it isn't worth a *secret* at all, only a soft filter. Q8's reasoning stands; its
  conclusion (a shared token) is now the weaker half of "no token, just a `User-Agent` filter."
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
- **~~Q6 — Check character in the code?~~ DECIDED 2026-08-16: NO.** The code is a **6-char plain
  Crockford base32** identifier, no 7th check character. A mistyped code just fails the binding
  lookup (uniform reject), it does not resolve to a stranger's parasol — the code is public routing,
  not a credential. Not worth the extra sticker character or the QR-version cost.
- **~~Q7 — Can a device accept a new token over the wire?~~ DECIDED 2026-08-16: YES → REVERSED
  2026-08-16 by Q9 (NO).** OTA rotation was reserved (`cmd: "rotateToken"`) while the credential was
  a *secret* worth re-keying on leak. Q9 removed the secret entirely (soft `User-Agent` filter), so
  there is nothing to rotate: `rotateToken` is **removed** from the `cmd` set (back to
  `null | stow | identify`), and the residual cost-abuse risk is handled by **edge rate-limiting**,
  not by pushing a new value to devices. Net: no rotation machinery in firmware or server.
- **~~Q9 — Real credential, or just a soft traffic filter?~~ DECIDED 2026-08-16: soft filter (a
  custom `User-Agent` value).** The threat-value logic behind Q8 taken to its conclusion: an asset
  not worth attacking is not worth a secret, only a filter that declines *obvious* non-sensor
  traffic. The gate is a configured `User-Agent` value (`Sunbnb-Sensor/1 (…opaque…)`) checked
  pre-DB; no token, hashing, rotation, or per-device secret. It is obscurity by design — proportion,
  not laziness — with **Vercel edge rate-limiting** as the cost-abuse backstop. Collapses Q2, Q7,
  the token half of P2, and most of P3. **Implemented 2026-08-16** in `hw-filter.ts`
  (`screenDeviceRequest`, renamed from `hw-auth.ts`): `User-Agent` CONTAINS `HW_CLIENT_UA`, unset
  fails closed, `HW_TOKEN` deleted. Revisit only if a device ever gains a consequential write
  path (Q5).

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
