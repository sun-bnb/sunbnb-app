# HW API — User App (`apps/user/app/api/hw/[code]/`)

Pulled on demand; **not** auto-loaded. The one-line route rows live in `apps/user/CLAUDE.md` § API
Routes. Intent, roadmap and decisions: `.claude/tracks/019-hw-api.md` (power modes:
`.claude/tracks/025-device-power-modes.md`; unit addresses: `.claude/tracks/021-physical-unit-model.md`).
Tests: `apps/user/TESTING.md` (`state/route.test.ts`, `telemetry/route.test.ts`, `device-report.test.ts`).

| Route | Method | Purpose |
|---|---|---|
| `/api/hw/[code]/state` | GET | Seat state for a mounted device + the tracking/telemetry uplink + the Wi-Fi downlink |
| `/api/hw/[code]/telemetry` | POST | Legacy escape hatch for a report that outgrows a header → `204` |

## Client filter (no auth — track 019 Q9)

- **Not a credential.** The data is public occupancy; the cost-abuse backstop is edge rate-limiting.
- The request `User-Agent` must CONTAIN `HW_CLIENT_UA` (an opaque needle; firmware sends
  `Sunbnb-Sensor/1 (<needle>)`, so a version bump needs no server change). Declines non-sensor
  traffic pre-DB. Unset `HW_CLIENT_UA` fails CLOSED (503).
- Failed filter and unknown code get a uniform opaque 401. Every other failure is non-200 so the
  device shows amber — never a false FREE.
- Shared filter (UA match, device-binding lookup, `normalizeCode`): `hw-filter.ts`
  `screenDeviceRequest`, used by both routes so they can't drift.
- A `retired` device and one with no seats bound are declined (an empty binding would aggregate to
  FREE); `provisioned` DOES serve, so bring-up isn't trapped behind a manual status flip.

## Seat resolution (`state`)

- Seats come from the device's **assigned ADDRESS** — one indexed `findUnique` on `SunbedGroup`
  `UNIQUE(site_id, parcel, row_idx, seq)` via `@repo/data/unit-address` `unitAddressWhere`
  (track 021). It replaced a parcel-wide fetch + JS row filter, when row lived inside the encoded
  seat number and three call sites re-derived it and could disagree.
- A device answers for whatever unit occupies its address today: a parcel rebuilt at the same spot
  needs no re-assignment. No unit there ⇒ non-200, never a free bed.
- Venue-local day; projection over `deriveState`; `ETag`/`304`.

## Power policy (track 025)

- Two platform preferences, not constants (`@repo/data/preferences`, admin `/preferences`):
  `powerMode` ← `device-power-mode` (continuous · light_sleep · deep_sleep, default `deep_sleep`),
  `pollAfterSec` ← `device-poll-interval-sec` (default 60 s). Read together through the 5-min
  per-instance cache — at ~1.3 M polls/day a query per poll would cost more than the control saves.
- Both sit inside the ETag-hashed `stable` object, so a mode/cadence change busts the 304 that
  would otherwise hide it from a device parked on a free bed.
- **The mode is an EXPLICIT field, not inferred from cadence** (D1): the bands overlap at 10–15 s
  and 30 s, and "30 s but stay associated" is not expressible as a number.
- `resolveDevicePolicy` (`@repo/data/device-power`) fits the cadence to the mode's band — the second
  check behind the admin write path (an env override or SQL edit can present a number no mode can
  serve). An unreadable mode falls back to `deep_sleep`, never continuous.
- **Per-device override:** a device with its own complete pair (`Device.powerMode`/`pollIntervalSec`,
  partner fleet page) runs that, via `resolveDevicePolicyForDevice`. It rides the device row the
  filter already reads (no extra query), so it lands on the NEXT poll; a platform change waits out
  the 5-min cache. Half-set/unreadable override → platform pair; out-of-band → clamped inside its mode.
- Deferred: per-site policy, state-aware cadence, night backoff.

## Tracking on the poll (wire v2, 2026-09-12; extended 2026-09-22, v2.2 2026-09-26)

- The self-report is the `x-sunbnb-telemetry` request header
  (`fw;batt;vmin;rssi;up;temp;cur;imax;chg;rst;mode;heap;fails;ctemp;disc;iv;chan;full;loc`, `k=v;…`,
  every key optional, ≤512 bytes), parsed by `device-report.ts` and recorded by the screen step
  BEFORE the assignment check — an unassigned device (and, with an `x-sunbnb-partner` claim, an
  unknown code) reaches the fleet list from its first poll.
- **Columns:** nineteen keys earn a last-value column on `Device`. v2.2 adds `drops retry joins
  stale tmo slp` as columns on both `device` and `device_telemetry`; only `polls wake wjoin` and
  unknown keys are still dropped. `ssid` → `reportedSsid`; `netfail=1` → per-reading `netFail`, on
  `Device` stored as `netFailAt` (a TIMESTAMP — firmware only sends the failure, a boolean would latch
  true forever under omit-don't-zero). Both trigger a write.
- **What the keys tell you:**
  - `chg` (net µAh) — solar energy balance and the real state-of-charge signal (LiFePO4 rests
    3.2–3.3 V on a flat curve; `batt` alone barely ranks a fleet).
  - `rst` — `brownout` = supply sagged under load, the only attribution a field reboot gets.
  - `mode`+`iv` — the APPLIED power policy (closes track 025's assigned-vs-applied loop).
  - `disc` — the face the unit is SHOWING, in our state vocabulary; catches a device that polls
    happily and renders the wrong thing.
  - `joins`/`drops` climbing = the AP is dropping the device; `stale`/`tmo` climbing = the kept-open
    poll connection is dying (was only visible on a USB console; 64% of a 75-min hotspot drain).
- **`chargeUah` has a MOVING ZERO:** firmware anchors it at charge-complete and `fullCount` counts
  those firings. A delta across a `fullCount` change is not a discharge — check `full` first. A
  `fullCount` DECREASE is a power cut (clears the INA228 accumulator too).
- **`vminMv`/`imaxUa` are window SAMPLES**, reset every poll while writes are throttled: `vmin` earns
  its own trigger (the sag `battMv - vminMv` widening is the earliest cell-ageing signal); `imaxUa`
  rides along, dominated by whether the window held a Wi-Fi join.
- **Enum words match by shape, not case, and keep it:** `rst`/`mode` lower-snake, `disc` CAPS
  (`seat_state_name()` returns our own tokens; folding case breaks the comparison). `?` = "cannot
  name this" → dropped.
- **The connectivity ladder is not a fault:** a device that loses the server degrades to light/15 s
  then deep/3600 s and cannot report meanwhile; the outage lands on ONE recovering poll with
  `fails` ≫ 0 beside `mode`/`iv` that disagree with the assignment. Read `fails` before calling it
  disobedience.
- **Absent key = "I don't know"** — stored value left alone, never zeroed (writer OMITS, not nulls).
  For `cur`/`chg`/`fails` a reported 0 is a real measurement and is stored.
- **Sentinels re-checked server-side** and read as absent: `batt ≤ 0`, `rssi = 0`, `temp ≤ −999`,
  `heap ≤ 0`, `fails < 0`, `mode=?`. The legacy POST sent `battMv: 0` unconditionally — origin of the
  zero-is-unknown branch in the partner fleet page. Both paths share one recorder.

## Write throttle and the telemetry series

- **Last-value row (`Device`) is THROTTLED** by `reportIsDue`: fw/loc/rst/mode change, `fails`
  crossing zero, ≥50 mV, ≥6 dB, ≥5 °C, ≥5 000 µAh, ≥8 KiB heap, uptime drop, or the 5-min
  `lastSeenAt` floor — so a 1–15 s cadence never multiplies row writes. The `Device` read the screen
  step already makes supplies the comparison.
- **`cur` triggers NOTHING** — it swings ~3.5 mA asleep to ~20 mA awake inside one poll.
- A failed write never changes the response.
- **Every reading is APPENDED to `device_telemetry`** (track 019 P6), UNthrottled, in the same
  transaction as the Device row when that is due. `Device` is a cache; the series is the record.
  No header = no row (not a row of nulls).
- Row rate = poll rate (1440/device/day at 60 s, 5760 at 15 s), so retention is load-bearing.
  Nothing reads it yet — trends cannot be backfilled. Bounded by the
  `device-telemetry-retention-days` preference, swept by `/api/cron/prune-telemetry` (bounded
  chunks + per-run ceiling; `complete: false` = resumes tomorrow, not a failure; lives in the user
  app because telemetry is WRITTEN here).

## Wi-Fi downlink (`ssid` + `password` broadcast)

- Q9 makes the endpoint credential-free and device codes are public, so the pair is delivered only
  inside an explicitly confirmed 30-minute window opened from admin `/preferences`, and each device
  is served **exactly once** in it (`Device.wifiSentAt` vs the broadcast start — a new broadcast
  re-arms the fleet; a mistyped password is fixed by broadcasting again). Both fields or neither.
- Rides the hashed `stable` object, so the credential-carrying poll is never a 304. The send is
  recorded only on the 200 path (marking before the 304 check would burn the delivery on an empty
  reply); the write is best-effort (a failure repeats the send). Rules: `@repo/data/device-wifi`.

## Legacy `POST /api/hw/[code]/telemetry`

- Same last-value set by COLUMN name — `{ fw, battMv, rssiDbm, upSec, tempC, currentUa, chargeUah,
  resetReason, reportedPowerMode, heapFreeBytes, pollFails, cellTempC, reportedFace,
  reportedIntervalSec, wifiChannel, vminMv, imaxUa, fullCount, loc }` → `204`.
- Not the tracking path (firmware never called it; the fleet list went blind) — kept for a report
  that outgrows a header. Same filter (`track: false`), same recorder (`recordDeviceReport`) but
  UNthrottled. Past the filter the `204` never depends on body or DB — telemetry must never fail
  the device's poll loop.
