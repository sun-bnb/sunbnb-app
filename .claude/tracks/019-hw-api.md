---
id: 019-hw-api
title: HW API — device state endpoint + telemetry
status: proposed
created: 2026-08-13
updated: 2026-09-12
worktree: null
---

## Goal

Serve the parasol-mounted hardware device built in the sibling repo `../sunbnb-hw` from this
backend, with **no new infrastructure**: no MQTT broker, no fleet worker, no separate service.
The device is an ESP32-C6 that joins Wi-Fi and does exactly two HTTPS calls against this app:

```
GET  /api/hw/{code}/state       → the seat state its LED bar renders; carries the device's
                                   self-report (battery / RSSI / uptime / running location)
                                   as the `x-sunbnb-telemetry` request header — wire v2
POST /api/hw/{code}/telemetry   → LEGACY escape hatch for a report that outgrows a header;
                                   nothing calls it in normal operation
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

**▶ NEXT: the fleet UI has nothing reading the v2 columns.** As of 2026-09-22 the server stores
NINETEEN last-value fields per device and the partner devices page still shows four (last seen,
battery, RSSI, fw). Worth surfacing first, in the hardware doc's own order of value:
`resetReason = brownout` (the supply sagged under load — a failing cell or a bad connection, and
the only attribution a field reboot gets), `chargeUah` trending negative (the unit is losing the
energy race and will die), and `pollFails` non-zero while the device still reports. Then the two
remaining applied-vs-assigned loops: `reportedPowerMode` + `reportedIntervalSec` close track 025's
for POWER, and `reportedFace` closes one for STATE — a device rendering the wrong face while
polling happily is invisible to every other field.

**The history is now being collected** (P6, 2026-09-23): every recorded report is appended to
`device_telemetry`, retained for `device-telemetry-retention-days` (admin, default 365). Nothing
reads it yet — that is the other half of the next job, and the one that pays for the collection:
capacity learned from `chg` across an anchor-to-cutoff span, `chg`/day per unit against the fleet,
`batt − vmin` widening over weeks.

**Two traps for whoever builds that page.** `chargeUah` is a counter with a moving zero — take a
delta across a `fullCount` change and you will read an anchor as a catastrophic discharge; and
`vminMv`/`imaxUa` are window SAMPLES, not the worst since the last write (see §Wire contract).

**Read the ladder before designing those badges.** `mode`/`iv` disagreeing with the assignment can
mean the device backed ITSELF off after losing us (see §Wire contract → the ladder), so the gap is
a fault only when `fails` says it is not. Nothing is blocked — the data is written on every poll
that earns one.

**▶ WIRE v2 — 2026-09-12: ONE request; field set extended 2026-09-22.** Tracking, assignment and
identification all ride the state poll. **Uplink** is the `x-sunbnb-telemetry` request header
(`fw=…;batt=…;rssi=…;up=…;temp=…;cur=…;chg=…;rst=…;mode=…;heap=…;fails=…;loc=…`), recorded by the
shared screen step with a THROTTLED write, before the assignment check — so an unassigned device
registers and appears in the fleet list from its first poll. **Downlink** is unchanged: `location`, `cmd` and `pollAfterSec` inside the hashed
`stable` object. The telemetry POST is kept as an escape hatch and writes through the same
recorder, unthrottled. Trigger: the firmware had stopped calling the POST ("to be folded into
the poll"), so the fleet list showed *Silent · 25d ago* for a device polling every minute.
Full definition: **§Wire contract → Tracking rides the poll** (the field table is normative;
`../sunbnb-hw/docs/telemetry-fields.md` describes what the firmware emits and defers to it).
Server: `apps/user/app/api/hw/[code]/device-report.ts` (+ `hw-filter.ts` `screenDeviceRequest`),
143 HW tests green.
Firmware half applied in `../sunbnb-hw` (`api.h`/`api.c`/`main.c`, builds clean, UNCOMMITTED,
not flashed) — the hardware project should read this contract and take or redo that diff.


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

**✅ FIRMWARE ALIGNED 2026-08-17 — `../sunbnb-hw` commit `95de474`** (builds clean, not
flashed). Both halves of the contract now implement the same model, verified field by field:
the state response carries `location`, the device echoes it back as `loc` in telemetry, and
telemetry serves a device with NO assignment (`requireBinding: false`) — which is what lets an
unassigned unit appear in the fleet list to be assigned from. 72 HW route tests green.

Firmware decisions worth keeping visible: telemetry now fires **as soon as the location
changes** rather than on the 12-hour cadence, because the fleet UI reads the assigned-vs-
reported gap and would otherwise show "not applied" for half a day after a device had already
converged; and a location counts as reported only once the POST actually returned 2xx, so a
dropped request retries at poll cadence instead of leaving a unit looking permanently
un-converged.

**Correction carried into both repos:** `seats[]` is NOT in mount order — it is seat order
within the unit, so a device mounted ROTATED lights the wrong half of the bar. That was **Q2 — RESOLVED
server-side 2026-08-17**: a per-device `reverseSegments` flag flips the emitted order, so the
firmware needs no change (it still lights `seats[i]` on segment `i`) and never holds a second
opinion about a physical fact. **With Q2 closed, nothing about the wire is known-wrong — the
contract can be frozen at bring-up.**

Noted by the founder and worth preserving: ADR 0008's binding bullet has held **three models
in five days** — anchor seat, `DeviceSeat` list, assigned location. That churn is itself the
argument for the device never storing a binding.

**Bring-up prerequisites (still outstanding):** `HW_CLIENT_UA` set on the target env (not set
locally today) and a `Device` row with the customer + a location, or nothing goes green.

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

**`GET /api/hw/{code}/state`** · `User-Agent: <configured sensor value>` · `If-None-Match` · `x-sunbnb-partner: <partner code>` · `x-sunbnb-telemetry: <self-report, wire v2 — see *Tracking rides the poll* below>`

```jsonc
{
  "code": "7QK3M2",
  "state": "OCCUPIED",          // aggregate over seats — the simple device reads only this
  "seats": [                    // per-seat, in mount order: a parasol = 2 beds, and the
    { "id": "clx…", "label": "A12", "state": "FREE" },     // LED bar can split left/right
    { "id": "cly…", "label": "A13", "state": "OCCUPIED" }
  ],
  "pollAfterSec": 60,           // server-driven cadence; device obeys, firmware never hardcodes
  "powerMode": "deep_sleep",    // continuous | light_sleep | deep_sleep — how the device spends
                                //   the gap between polls (track 025). EXPLICIT, not inferred
                                //   from pollAfterSec: the bands overlap. Always paired with a
                                //   cadence its band can keep; an unreadable value serves
                                //   deep_sleep, never continuous
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

**`powerMode` (added 2026-09-12, track 025).** A closed set — `continuous` · `light_sleep` ·
`deep_sleep` — served inside the hashed `stable` object beside `pollAfterSec`, so a fleet-wide
switch busts the ETag and reaches a device parked on a free bed that would otherwise 304 for
hours. **Firmware must recognise every member before potting**, like `cmd`: an unknown mode on a
sealed unit is ignored forever. Both values come from platform preferences (`device-power-mode`,
`device-poll-interval-sec`, admin `/preferences`) UNLESS the device carries its own pair
(`Device.powerMode`/`pollIntervalSec`, partner `/devices` — track 025, 2026-09-14), in which case
that wins; the wire shape is identical either way, so firmware neither knows nor cares which tier
answered. The server guarantees the PAIR is servable — each mode keeps only its own band (continuous 1–15 s · light sleep 10–45 s · deep
sleep 30–300 s — floors measured in `../sunbnb-hw` exp 005; light sleep's 45 s ceiling is an
operating choice past the 27 s crossover, where holding the association still beats a rejoin per
wake on a fussy AP), the admin write path refuses an out-of-band interval — the `/preferences`
form saves the pair through `setDevicePolicy` and refuses a mode change the cadence cannot
follow, the single-key path re-fits — and the route clamps again on the way out.
An unreadable mode resolves to `deep_sleep`: a wrong slow value costs response time, a wrong
`continuous` costs the cell in days. The bands OVERLAP deliberately at 10–15 s and 30 s, which is
why this is a field of its own rather than something inferred from the number (D1).

**Tracking rides the poll (wire v2, 2026-09-12; field set extended 2026-09-22).** The device's
self-report travels on the state GET as ONE request header, alongside `User-Agent`, `If-None-Match`
and `x-sunbnb-partner`:

```
x-sunbnb-telemetry: fw=0.1.0;batt=3174;vmin=3102;rssi=-36;up=412;polls=27;slp=850;temp=24;drops=2;retry=5;cur=25100;imax=82700;chg=-1852;rst=poweron;mode=light_sleep;heap=241088;fails=0;ctemp=31;disc=FREE;iv=60;chan=6;full=2;loc=1-1-1
```

That is a LIGHT-sleep unit: `slp` applies and `wake`/`wjoin` do not. A deep-sleep one swaps them,
so **22 keys is a full report, not 24** — the table has 24 rows. A measured one came to 179 bytes.
Verified against `../sunbnb-hw` `firmware/device/main/api.c` `api_format_report` at `2feb0ad`, which
is the emitter of record — `docs/telemetry-fields.md` there describes the same set, but its prose
example omits `slp` on a light-sleep device and shows `fw` as a git short hash when `FW_VERSION` is
currently the literal `"0.1.0"`.

- `key=value` pairs, `;`-separated, in the order below, whitespace around pairs tolerated.
  **Every key optional**; send it on **every poll** (the server throttles, the device does not).
  **512 bytes max** including the terminator — on overflow the firmware emits an EMPTY header
  rather than a truncated one, because a truncated integer parses as a plausible wrong number.
- **Stored keys** (each a last-value column on `Device`):

  | Key | Type / unit | Column | Notes |
  |---|---|---|---|
  | `fw` | string ≤64 | `fw` | Today a static `FW_VERSION` (`"0.1.0"`), not a build hash. The key is emitted even when the value is NULL, so **`fw=` is on the wire** — an empty value is read as absent, never stored as `""` |
  | `batt` | int, mV | `battMv` | Cell voltage. LiFePO4's curve is flat 3.2–3.3 V — **do not derive a percentage from it**; that is `chg`'s job |
  | `vmin` | int, mV | `vminMv` | **Lowest** cell voltage in the last poll window. `batt` is a spot reading and spot readings land BETWEEN the radio's bursts. **Read it as a gap:** `batt − vmin` is the sag under load, and that gap widening over weeks is internal resistance rising — the cell ageing, visible long before resting voltage moves, and the earliest warning that bursts are about to brown the chip out |
  | `rssi` | int, dBm, negative | `rssiDbm` | Prices a poll (~7× energy between −80 and −34 dBm) and predicts join failure |
  | `up` | int, seconds | `upSec` | A **DROP** is the reboot signal — pair with `rst` for the cause |
  | `temp` | int, °C | `tempC` | **ESP32 on-die**, not the cell and not the air. A trend, not a calibrated reading |
  | `cur` | int, µA, **signed** | `currentUa` | **Positive = discharging, negative = charging.** µA because deep sleep lives near 3.5 mA |
  | `imax` | int, µA, **signed** | `imaxUa` | **Highest** cell current in that window. Prices the burst instead of the idle — one sample mid-join measured 82.7 mA against a ~25 mA idle. Rising `imax` beside falling `vmin` is the same ageing story from the other side. **Understates the true peak by design; never a headline number** |
  | `chg` | int, µAh, **signed** | `chargeUah` | Net charge since the counter was zeroed — the solar energy balance, and the real state-of-charge signal. **ANCHORED since 2026-09-22**: the firmware zeroes it at charge-complete, so it reads "µAh drawn since the cell was last full" — but only from the first `full` step on. An `up` drop does **not** reset it; a `full` change does. **Any consumer taking a `chg` delta must check `full` first** |
  | `rst` | word ≤32, `[a-z0-9_]` | `resetReason` | `poweron` · `brownout` · `panic` · `wdt` · `sw` · `deepsleep` · `other`. **`brownout` is the one to alert on.** An unknown word is STORED, not dropped — a stale reason beside a fresh crash is worse |
  | `mode` | word ≤32, `[a-z0-9_]` | `reportedPowerMode` | The mode **actually in force**, not the stored setting — a console cable holds a unit in continuous whatever NVS says. The applied half of track 025's loop. `continuous` · `light_sleep` · `deep_sleep`, or **`?`** — the firmware's `power_mode_name()` returns `?` for a mode outside its table, and `?` is DROPPED, not stored: it says "I cannot name my mode", which is an absent value, not a new one |
  | `heap` | int, bytes | `heapFreeBytes` | Smallest free heap since boot — the only leak detector once a unit is potted |
  | `fails` | int | `pollFails` | Consecutive failed polls. The device zeroes it on a success and builds its report BEFORE polling, so a non-zero value arrives on exactly one poll — the one that RECOVERED. Read it as "what the outage cost", not "failing now" |
  | `ctemp` | int, °C | `cellTempC` | **CELL-side**, from the INA228's own die — not `temp`, which is the ESP32's. Speaks to cell capacity, and is the only measurement of the case interior that exists: the 40–45 °C the PETG choice rests on was an estimate |
  | `disc` | word ≤32, `[A-Za-z0-9_]` | `reportedFace` | The face the disc is **actually showing** — `FREE` · `RESERVED` · `OCCUPIED` · `UNAVAILABLE` · `STALE`, our OWN state vocabulary handed back. The third applied-vs-assigned loop after location and power, and the only way to catch a device that polls happily and renders the wrong thing. `?` for an unknown state, dropped like `mode`'s |
  | `iv` | int, seconds | `reportedIntervalSec` | The poll interval **in force** — the applied half of `pollIntervalSec`. Also exposes the ladder (below), so a disagreement is not automatically disobedience |
  | `chan` | int | `wifiChannel` | Wi-Fi channel. Separates units on different APs in one venue, which RSSI alone cannot — the cheapest way to find the one bad AP behind a cluster of weak units |
  | `full` | int | `fullCount` | Charge-complete firings. **Load-bearing for reading `chg`:** after the first step `chg` means "µAh drawn since the cell was last full", and a step here is the only thing that distinguishes a real anchor from someone typing `ina reset` at a bench. Lives in RTC memory — survives deep sleep, DECREASES to 0 on a power cut, which also clears the INA228's accumulator |
  | `loc` | string ≤64 | `reportedLocation` | The location the device is RUNNING — echo of the last `location` it adopted |

- **Enum words are matched by SHAPE, not case, and the case is preserved.** `rst`/`mode` are lower
  snake (`brownout`, `light_sleep`); `disc` comes back in CAPS because `seat_state_name()` returns
  the exact tokens our own projection emits. Folding the case would break the one comparison `disc`
  exists for. A firmware `?` (both `power_mode_name` and `seat_state_name` return it for a value
  outside their tables) means "I cannot name this" and is DROPPED — the one case where leaving the
  last known value alone is right, because it is an absent value, not a new one.
- **Accepted and dropped** (diagnostic detail that reads well in a log line and does not earn a
  schema): `polls` · `slp` · `wake` · `wjoin` · `drops` · `retry`. An unknown key is likewise
  ignored, so firmware may add one without a server change.
- **Omit a field you do not know** rather than sending `0` or an empty value: **an absent key means
  "I don't know" and leaves the stored value alone — it does not mean zero.** The server's writer
  OMITS rather than nulls, and `0 mV` would overwrite a real reading with a dead cell. The converse
  holds for `cur`, `chg` and `fails`, where zero is a real measurement (an idle cell, an exactly
  balanced day, a device polling happily): the firmware carries validity flags for those rather
  than using 0 as a sentinel, and the server stores a reported 0.
- **The server re-checks the sentinels rather than trusting them.** `batt ≤ 0`, `rssi = 0`,
  `temp ≤ −999`, `heap ≤ 0` and `fails < 0` are read as ABSENT, mirroring the firmware formatter's
  own guards. This is not belt-and-braces: the legacy POST applies none of them and sends
  `{"battMv":0,"rssiDbm":0}` unconditionally, which is how a `battMv: 0` reached the fleet list and
  forced the "a zero reading is the ABSENCE of a measurement" branch in
  `apps/partner/app/devices/device-health.ts`. Enforcing it in the shared recorder makes the two
  paths mean the same thing, which was the point of sharing one.
- **Recorded before any decline.** The screen step reads the `Device` row once, records the report,
  and only then checks the assignment — so a device with no location is still tracked, and an
  UNKNOWN code with a valid `x-sunbnb-partner` claim is REGISTERED (self-registration moved here
  from the POST). Filtered-out traffic (bad `User-Agent`) is never recorded. A failed write never
  costs the device its poll: the response is whatever it would have been.
- **Throttled write.** The row is written when `fw`, `loc`, `rst` or `mode` changed, `fails`
  crossed the zero/non-zero edge, battery moved ≥50 mV, RSSI ≥6 dB, `temp` ≥5 °C, `chg` ≥5 000 µAh,
  `heap` ≥8 KiB, `up` DROPPED (reboot signal), or `lastSeenAt` is older than 5 min; otherwise the
  poll touches nothing beyond the read it already makes. The partner claim (a partner lookup) runs
  on the same throttle. This is what keeps track 025's 1–15 s continuous cadence affordable —
  **adding thirteen keys to the report did not add thirteen triggers.** Two deliberate omissions:
  `cur` NEVER triggers a write (it swings between ~3.5 mA asleep and ~20 mA awake inside one poll,
  so any threshold degenerates into a write per poll — it rides along on writes earned by something
  else, and `chg` integrates it anyway), and `fails` triggers on the EDGE rather than the count,
  because a device being declined every poll would otherwise write every poll. `disc`, `iv` and
  `chan` are change-triggered like `mode` — all discrete and rare; `disc` moves a few times a day
  per seat, not per poll, and each move is the applied seat state, which is worth a row. `full`
  triggers on ANY change including a decrease, because it is what makes `chg` readable at all.
  `vmin` is thresholded on `batt`'s own band; `imax` rides along like `cur`, being dominated by
  whether the window held a join.

- **A window value in a throttled store is a SAMPLE.** The device resets its extremes every poll,
  so each report's `vmin`/`imax` covers one poll interval — but we write on a throttled subset, so
  the row holds *the window ending at the last write*, not *the worst since the last write*. That
  is honest for the trend the pair is for (the sampling point is fixed in the poll cycle, so two
  reports are comparable), and it is exactly why `vmin` earns a trigger: without one, a 60 s
  cadence under the 5-min floor samples one window in five and systematically misses the bad ones.
  It is also the strongest argument yet for the deferred time series — a series keeps every window
  rather than a sample of them.

**The connectivity ladder is not a fault** (`../sunbnb-hw` `1b6c00b`). A device that cannot reach us
degrades ITSELF — `light_sleep` at 15 s while it retries, `deep_sleep` at 3600 s once it gives up
(20 failures ≈ 5 min). It cannot report while that is happening, so the whole episode lands on the
ONE poll that recovers, carrying `fails` ≫ 0 beside a `mode`/`iv` that disagree with what we
assigned and `disc=STALE`. All of those trigger, so the recovery is recorded; the next poll — after
the device has taken the mode from our 200 and zeroed its counter — records the return to normal.
Two rows for an outage of any length. **A consumer must not read that first row as disobedience:**
`fails > 0` with `iv = 3600` is a unit that backed off deliberately and is now costing almost
nothing, not a unit that is broken. Any 200 restores the served mode.
- **Both directions declarative.** The device says what it runs on every poll; the server says what
  it should run on every 200. The fleet UI's assigned-vs-applied gap needs no ack protocol — the
  old "reported only once the POST returned 2xx" firmware rule is gone.
- **Time series SHIPPED (2026-09-23), UNTHROTTLED.** Every `Device` column above is still a LAST
  VALUE — that is what the fleet list reads — and **every reading is appended to
  `device_telemetry`, one row per poll that carries a report**. The throttle above governs the
  last-value row ONLY, and that split is the point: `Device` is a cache of the latest reading, so
  skipping a write to it loses nothing now that the history is complete, while the series is the
  record and a record with holes cannot say what the cell did between two samples. A poll with no
  report header appends nothing — no reading is not a row of nulls. The series carries `mode` and
  `iv` as well as the numbers, because the energy questions are asked PER MODE. Retention is
  `device-telemetry-retention-days` (admin preferences, default 365), swept daily by
  `/api/cron/prune-telemetry`, oldest first. **Nothing reads it yet** — it is collected at full
  fidelity now because a trend cannot be backfilled.

**`POST /api/hw/{code}/telemetry`** — LEGACY escape hatch, `{ fw, battMv, rssiDbm, upSec, tempC,
currentUa, chargeUah, resetReason, reportedPowerMode, heapFreeBytes, pollFails, loc }` → `204`. The
body names the COLUMNS where the header names the wire keys — it predates the header and is written
by hand, not by the poll loop. The SERVER accepts that whole set; the firmware's
`api_post_telemetry` still builds the v1 six (`fw` `loc` `battMv` `rssiDbm` `upSec` `polls`) and
nothing calls it in normal operation, so the extra fields are for a hand-written boot dump. Same client filter, same recorder as the header, but UNTHROTTLED (a call
here is rare and explicit). Not called by firmware in normal operation; kept for a report that
outgrows a header (a boot diagnostic dump). Never fails the device's poll loop: a malformed or
absent body, and a database that is down, are all `204`.

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
- **◧ P5 — telemetry persistence + operator health view.** *Persistence DONE* — last-values
  writes shipped 2026-09-12, extended to the full v2 field set 2026-09-22 (twelve columns; see the
  §Wire contract table). The partner list exists and shows last seen, battery, RSSI, fw. *Health
  view still owes the v2 signals:* `resetReason` (`brownout` first), `chargeUah` trend,
  `pollFails`, and `reportedPowerMode` as an assigned-vs-applied badge. Note cell VOLTAGE is the
  weaker of the two energy numbers on this chemistry — `chargeUah` is the one that predicts a
  field failure; `battMv` barely ranks a fleet between 3.2 and 3.3 V.
- **◧ P6 — telemetry history. COLLECTION DONE 2026-09-23; nothing reads it.** `device_telemetry`
  (BIGSERIAL id — the one table expected to reach 10^8 rows, where a cuid costs ~3x an int8 in the
  heap and again in every index) takes a row per recorded report, written in the poll's own
  transaction. Bounded by `device-telemetry-retention-days` (default 365) and swept daily by
  `/api/cron/prune-telemetry`, which deletes in bounded, resumable chunks rather than one
  unbounded DELETE — the table is largest exactly when someone has just shortened the window.
  **The open question is volume, not correctness**, and it got sharper when the series was
  unthrottled (founder call, same day): the POLL INTERVAL now sets the row rate — 1440
  rows/device/day at the 60 s default, 5760 at the ladder's 15 s. One unit under bring-up is
  trivial; **a 1500-unit fleet at 60 s is ~2.2e6 rows/DAY**, ~8e8 rows and past 100 GB at a
  365-day window. Three levers, in order of bluntness: shorten retention (one admin field),
  lengthen the poll interval, or reintroduce a sampling floor for the series alone. Next: something
  that READS it — capacity learned from `chg` across an anchor-to-cutoff span, `chg`/day per unit
  against the fleet, `batt − vmin` widening.
- **💤 P7 — fleet scale.** Only when a real fleet exists: edge runtime, short-TTL per-site cache,
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

  **Partial, 2026-08-18: the cadence is now a knob, not a constant.** `pollAfterSec` reads the
  `device-poll-interval-sec` platform preference (`@repo/data/preferences`, set on the admin
  `/preferences` tab; registry default 60 s, bounds 10–3600), so the whole fleet can be slowed
  down without a deploy — the cheapest available answer to an invocation bill, and the one that
  works on already-potted units. Read through a 5-minute per-instance cache: a synchronous
  lookup on every poll would spend what the knob exists to save, at the cost of a change taking
  up to the TTL plus one poll to land. **State awareness is still deferred** — this is one number
  for every device in every state. It stays inside the ETag-hashed `stable` object, which is what
  lets a change reach a device that has been 304ing on a free bed for hours.
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

- **2026-09-12 — WIRE v2: tracking folded into the state poll; one request carries everything.**
  Found via the partner fleet list on test: Brisa Marina's `QWGGVX` read *Silent · 25d ago* while
  the device had been polling all day. The firmware had dropped the telemetry POST ("being folded
  into the state poll", `../sunbnb-hw` `bdc7ff9` recorded it as an open decision), and `lastSeenAt`
  was only ever written by that POST. Decision (founder, on the argument that a second request on
  a battery-constrained device is a request that gets dropped, and that on an open connection it
  costs ~0.0013 mAh either way — the cost was never energy, it was two code paths): the report
  rides the poll as the `x-sunbnb-telemetry` request header; assignment (`location`) and
  identification (`cmd`) already rode the response and stay there; the POST is kept as an
  unthrottled escape hatch. Server: new `device-report.ts` (parser, `reportIsDue` throttle,
  `recordDeviceReport`), `screenDeviceRequest` does ONE `Device` read for assignment + last
  values and records before the assignment check (so unassigned devices register on the poll);
  the telemetry route screens with `track: false` and writes through the same recorder with
  `force`. Throttle: `fw`/`loc` change, ≥50 mV, ≥6 dB, uptime drop, or 5-min `lastSeenAt`
  floor — bounds writes to roughly what the periodic POST would have cost even at track 025's
  1 s cadence. HW suite 111 green (21 report + 19 telemetry + 71 state), user app 690 green, tsc
  + lint clean. Firmware half applied in the sibling repo (uncommitted, builds clean): `api_poll_
  state(const telemetry_t *)` sets the header per request, `main.c` builds the report per poll and
  marks the location reported on any `ok` poll. `batt` is omitted until the ADC lands. Track 025
  D1 gains a settled direction: whatever the mode field is, it rides the response inside `stable`.

- **2026-09-12 — `powerMode` joins the wire (track 025 Phase 2, server half).** The response now
  carries the power mode beside the cadence, both from platform preferences, both inside the
  hashed `stable` object. New pure `@repo/data/device-power` owns the three modes, their measured
  bands and `resolveDevicePolicy`; `@repo/data/preferences` gains an `enum` type (stored value is
  the wire id, never the label) and the registry's first COUPLED pair — an interval the active
  mode cannot keep is refused with the mode named, a mode change re-fits the stored interval, and
  the admin row reports what a device would actually be served rather than what is stored. The
  admin page resyncs every row after a save for that reason. Defaults chosen so nothing in the
  field changes today: `deep_sleep` at 60 s is exactly the cadence the fleet already runs, and 60
  sits inside the deep band. Tests: data 591 (45 preferences + 16 device-power), user 695 (HW 116,
  of which 76 state), admin 202, partner 2090; tsc + lint clean. **Firmware half NOT done** — the
  device must learn to read `powerMode` and switch `esp_pm_configure` / the deep-sleep branch at
  runtime, which is track 025 Phase 1 in `../sunbnb-hw`.

- **2026-09-22 — The v2 field set lands: five stored keys become twelve.** Trigger: the firmware
  gained fields 12–17 (`cur` `chg` `rst` `mode` `heap` `fails`) on `907f228` and documented the
  whole emitted set in `../sunbnb-hw/docs/telemetry-fields.md`; the server was keeping five keys
  and dropping the rest, so the most valuable measurements the hardware makes were being parsed
  and thrown away on every poll. Three of them change what is knowable at all: **`chg`** is the
  net energy balance since the counter was zeroed and is the real state-of-charge signal (LiFePO4
  rests 3.2–3.3 V on a flat curve, so `batt` alone barely ranks a fleet), **`rst=brownout`** is
  the only attribution a field reboot ever gets, and **`mode`** is the APPLIED power mode — track
  025's declarative loop could show an assigned-vs-applied gap for location but not for power,
  because the server only ever learned the mode it asked for. Added as nullable last-value columns
  (`20260922133255_add_device_telemetry_v2_fields`, additive, applied local + `sunbnb_test`):
  `tempC` `currentUa` `chargeUah` `resetReason` `reportedPowerMode` `heapFreeBytes` `pollFails`.
  `polls` `slp` `wake` `wjoin` `drops` `retry` stay accepted-and-dropped — log-line detail that
  does not earn a schema, which is what this track already said about `polls`.

  **The throttle did not grow with the field set**, and that was the design work. `rst`/`mode`
  trigger on change (discrete, rare, actionable that poll); `temp`/`chg`/`heap` are thresholded
  (5 °C · 5 000 µAh · 8 KiB) alongside battery and RSSI; **`fails` triggers on the zero/non-zero
  EDGE, not the count** — a device being declined every poll would otherwise write every poll,
  which is precisely the traffic the throttle exists for; and **`cur` never triggers at all** — it
  swings between ~3.5 mA asleep and ~20 mA awake inside one poll, so any threshold on it
  degenerates into a write per poll. It rides along on writes earned by something else, which is
  all a last value of an instantaneous current is worth, and `chg` integrates it anyway. Regression
  net for the bill: a full eighteen-key report that drifted inside every threshold writes nothing.
  Enum words (`rst`, `mode`) are shape-checked (`[a-z0-9_]{1,32}`) but NOT checked against a known
  list — dropping an unknown value would leave the previous reason standing next to a fresh crash.
  The legacy POST carries the same fields by column name and shares the recorder. HW suite 143
  green (37 report + 19 telemetry + 87 state), user app green, tsc + lint clean.
  **Not done, deliberately:** no time series (P6 — `chg` over days is what settles whether a unit
  is energy-positive, but that is a table, a retention policy and a write path), and **no fleet UI
  yet** — the columns are written and nothing reads them; the alerting order the hardware doc
  suggests (`brownout` → `chg` trending negative → climbing `fails` → declining `heap`) is the
  shape the partner devices page should take next.

  **Checked against the emitter, not the doc** (same day, after the first pass was written from
  `telemetry-fields.md` alone). `../sunbnb-hw` `api.c` `api_format_report` @ `907f228` is the
  source of truth, and it differs from its own doc in four ways that reached this side:
  1. **`mode=?` is reachable** — `power_mode_name()` returns `"?"` outside its table. Dropped, not
     stored: it means "I cannot name my mode", which is absent, not a new mode.
  2. **`fw=` is emitted for a NULL version** (the key is written unconditionally), and `FW_VERSION`
     is the literal `"0.1.0"`, not the git short hash the doc's example shows. Read as absent.
  3. **The legacy POST applies none of the formatter's sentinel guards** and sends
     `{"battMv":0,"rssiDbm":0}` unconditionally — the origin of the `battMv: 0` workaround in the
     partner fleet page. The sentinels now live in the shared recorder, so both paths agree.
  4. **The 512-byte overflow rule is not implemented as documented.** The doc promises an EMPTY
     header rather than a truncated one, but only the first `snprintf` (the `fw` field) empties the
     buffer; every later field guards with `(size_t)n < cap` while `n` already holds snprintf's
     would-have-written length, so an overflow yields a TRUNCATED header — and a truncated integer
     parses as a plausible wrong number, exactly the failure the rule exists to prevent. **Not
     reachable today** (worst case ≈ 340 bytes against a 512 buffer) and **not worked around here**
     — the fix belongs in the firmware, and a length heuristic on this side would codify the bug.
     Left as a hardware-side note.

- **2026-09-22 (second pass) — four more applied-state fields; the device now reports what it is
  DOING, not just how it is.** `../sunbnb-hw` `3e94d67` + `1b6c00b` added `ctemp` `disc` `iv`
  `chan` (22 keys in the table, 20 in any one report — `slp` and `wake`/`wjoin` are exclusive by
  mode; a measured report is 150 of 512 bytes). Stored as
  `20260922162512_add_device_telemetry_applied_state_fields` (additive, nullable, local +
  `sunbnb_test`): `cellTempC` `reportedFace` `reportedIntervalSec` `wifiChannel`. This goes BEYOND
  the hardware doc's "suggested storage" list, which was not updated for the four — the reasoning
  for each is in the field table, and `chan` is the marginal one (it is closest to the
  accepted-and-dropped counters; kept because there is no log to read it from instead).

  **`disc` is the valuable one**: the face the unit is actually showing, in our OWN state
  vocabulary. It is the third applied-vs-assigned loop after location and power mode, and the only
  one that catches a device polling happily while rendering the wrong thing — a failure a poll
  count, an uptime and a battery reading are all blind to.

  **Two firmware facts forced code changes rather than additions.** (1) `seat_state_name()` returns
  `FREE`/`RESERVED`/…/`STALE` in CAPS — our word rule was `[a-z0-9_]` and would have silently
  dropped every disc report. It is now `[A-Za-z0-9_]`, case PRESERVED, because `disc` is only ever
  read against the state we served and folding it would break that comparison. The cost is that
  `mode=DEEP` is now stored verbatim instead of rejected; that is the same trade already made for
  an unknown `rst`, and the firmware only ever emits lower snake there. (2) The **connectivity
  ladder** means `mode` and `iv` MOVE ON THEIR OWN when a device loses us (light/15 s, then
  deep/3600 s), and since it cannot report during the outage, the whole episode arrives on the one
  recovering poll. So an assigned-vs-applied gap in power is no longer automatically a fault —
  documented in the contract, and pinned by a test, because the fleet UI is about to read exactly
  those columns and "backed off deliberately" and "not obeying" look identical without `fails`.

  Throttle unchanged in shape: `disc`/`iv`/`chan` change-trigger like `mode`, `ctemp` shares the
  5 °C band with `temp`. HW suite 154 green (47 report + 19 telemetry + 88 state), user app 733,
  tsc + lint clean, `migrate:check` clean.

- **2026-09-22 (third pass) — the charge counter gains an ANCHOR, and the cell gains a window.**
  `../sunbnb-hw` `2feb0ad` added `vmin` `imax` `full` (24 keys in the table, 22 in one report;
  measured at 179 of 512 bytes). Stored as `20260922164655_add_device_telemetry_cell_extremes`
  (additive, nullable, local + `sunbnb_test`): `vminMv` `imaxUa` `fullCount`. Nineteen columns.

  **`full` is the one that changes how an existing field must be read.** `chg` used to count from
  an arbitrary moment — "42 mAh since something". The firmware now detects charge-complete (CV
  ceiling AND tapered current, three polls running) and zeroes the counter there, so `chg` becomes
  "µAh drawn since the cell was last full". `full` counts those firings, and **a step in it is the
  only thing that distinguishes a real anchor from someone typing `ina reset` at a bench**. So any
  consumer taking a `chg` delta must check `full` first: across a step the counter was reset and
  the delta is not a discharge. It triggers a write on ANY change including a DECREASE — it lives
  in RTC memory and drops to 0 on a power cut, which also clears the INA228's accumulator, so a
  decrease invalidates a `chg` baseline exactly as a step does. The contract's `chg` row now says
  this; it is the kind of thing a fleet UI gets silently wrong once and never notices.

  **`vmin`/`imax` forced a genuinely new throttle question, not another threshold.** They are
  WINDOW extremes and the device resets its window every poll — but we write on a throttled subset,
  so the row holds *the window ending at the last write*, not *the worst since the last write*. At
  60 s under the 5-min floor that is one window in five, and the missed ones are exactly the bad
  ones. `vmin` therefore earns a trigger on `batt`'s own band (it is the same quantity read at the
  window's worst, and `batt − vmin` — the sag — is the earliest ageing signal available, moving
  long before resting voltage does). `imax` does NOT: it is dominated by whether the window held a
  Wi-Fi join (82.7 mA mid-join against ~25 mA idle), so a threshold fires on the join schedule
  rather than on anything actionable, and the hardware doc explicitly says never to publish it as a
  headline number. Both are documented in the code and the contract as SAMPLES, which is the
  strongest argument yet for the P6 time series — a series keeps every window instead of a sample.

  No parser surprises this pass: emission order, sentinels (`vmin > 0`, `full >= 0`, `imax` on a
  validity flag so 0 is a reading) and spellings all matched the doc. HW suite 158 green (50 report
  + 19 telemetry + 89 state), user app 737, tsc + lint clean, `migrate:check` clean.

- **2026-09-23 — telemetry history: keep every reading the server keeps.** Founder ask: save all
  telemetry readings, cap it from the admin preferences beside the power policy, a year by default.
  Built `device_telemetry` + `device-telemetry-retention-days` + a daily sweep.

  **The design question was what "every reading" can mean.** The device reports on every poll, and
  recording every poll is precisely what this track's throttle exists to avoid (~1.3 M polls/day,
  Q3) — so the series is written on the SAME trigger as the last-value row, in the SAME
  transaction. That keeps one throttle to reason about rather than two that drift, and makes the
  series exactly "the readings we kept". The cost is that resolution follows `reportIsDue`: at
  most one row per device per 5 min, plus one per notable change. Volume, stated because it is the
  thing that will bite: ~4.3e5 rows/day at 1500 units, ~1.6e8 for a year. The unbuilt lever is a
  coarser floor for the series than for the Device row (hourly ≈ 10x fewer rows and still answers
  every question the hardware doc lists, the finest being harvest bucketed by hour). Not built
  because the fleet is a handful of units and a second throttle is a second thing to keep honest.

  **Retention is the only bound**, so the preference is a storage budget, not a nicety — its
  description says so, and that shortening it DELETES history irreversibly on the next sweep. The
  sweep deletes in bounded chunks with a per-run ceiling rather than one `deleteMany`: it runs in a
  serverless invocation against a table that is largest exactly when someone has just cut the
  window, and a timeout mid-delete would mean the next run starts over. Chunked, it is resumable
  and idempotent by construction. `complete: false` reports the ceiling, not a failure.

  Admin needed NO code: the preferences page is registry-driven, so a `number` entry in group
  `Hardware` renders itself beside the coupled power card. Also unified the two writers behind one
  `measurementData()` — the last-value row and the series were listing nineteen fields each, which
  is exactly the duplication that drifts. Tests: 6 for the cron gate (it destroys data no backfill
  can reconstruct, so an unset secret fails CLOSED), 7 for the sweep, 6 for the append and for the
  throttle declining to append. Turned `preferences.test.ts`'s hand-written key list into one
  derived from the registry — it broke on the new key while asserting nothing a registry-derived
  check does not. User 749, data 625, admin 206, tsc + lint clean, `migrate:check` clean.

- **2026-09-23 — the series is UNTHROTTLED; the throttle keeps the last-value row only.** Founder
  call, hours after P6 shipped: "we don't need it at the moment, write down literally every
  reading." The first cut had the history inherit `reportIsDue`, which made it at most one row per
  device per 5 min — defensible for a 1500-unit fleet, wrong for the fleet that exists, which is
  one board under bring-up polling every 15 s. A throttled series answers "what did the cell do
  between 10:33 and 10:38" with a shrug, and bring-up is exactly when that question is asked.

  The split is now explicit and is the reason this costs nothing: **`Device` is a CACHE of the
  latest reading, `device_telemetry` is the RECORD.** Skipping a last-value write loses no
  information once the history is complete, so `reportIsDue` keeps doing its real job (bounding
  row writes on the poll path, which is what track 025's 1 s cadence rests on) while the series
  takes every reading. The partner claim stays on the throttle too — it is a device's identity,
  not one of its readings, and it costs a partner lookup. A poll with no report header appends
  nothing: no reading is not a row of nulls, and a fabricated sample would corrupt every average
  taken across it.

  **Consequence to watch:** the poll interval is now a STORAGE lever as much as a battery one.
  1440 rows/device/day at 60 s, 5760 at 15 s; ~2.2e6 rows/day at 1500 units. Retention is the
  blunt instrument and it is one field in the admin app. The arithmetic is in
  `packages/data/src/device-telemetry.ts`, the preference description an operator actually reads,
  and the roadmap above — deliberately in all three, because this is the kind of number that is
  obvious the day it is written and invisible the day it matters. Tests: the old "appends NOTHING
  when the throttle declines" case is inverted (it now asserts the reading IS kept while the
  last-value row is not written), plus a case for the no-header poll. User 750 green.

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
