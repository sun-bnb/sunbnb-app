---
id: 025-device-power-modes
title: Device power modes — server-selected cadence bands
status: proposed
created: 2026-09-11
updated: 2026-09-11
worktree: null
---

## Goal

Let the **server choose how responsive a device is**, across three power modes whose
cadence bands do not overlap by accident but by physics:

| Mode | Cadence | Draw | 1500 mAh cell, no sun |
|---|---|---|---|
| **Continuous** | 1–15 s | ~20 mA | ~3 days |
| **Light sleep** | 10–60 s | ~6.55 mA | ~9 days |
| **Deep sleep** | ≥ 60 s | ~11 mAh/day @60 s | ~4.5 months |

**Why it matters.** 15 s versus 60 s of response time is a product-visible difference —
a guest reserves from their phone and walks up to the lounger. But 15 s all day costs
~40× what 60 s does, so it cannot be the permanent setting. A venue should be able to run
responsive during service hours and frugal overnight, decided centrally rather than
flashed per device.

**Why cadence alone will not do it.** The server already drives cadence via
`poll_after_sec`, and that is enough *within* a mode. It cannot cross between them: deep
sleep has a floor around 60 s because every wake pays a full Wi-Fi join, and continuous
cannot be afforded for a whole day. The mode is the thing cadence cannot express.

**Out of scope:** push transport / websockets. HTTP polling is sufficient at these
cadences and a persistent connection would need an amendment to
[ADR 0008](../../../sunbnb-hw/docs/decisions/0008-direct-https.md). Revisit only if the
1 s end of continuous mode turns out to matter.

## Resume here

**Next action — Phase 1.** The measurement this track was going to open with has already
been done; see the Log entry for 2026-09-11 (revised). The band boundaries are grounded in
exp 005's measured figures, not in projections, so the design can proceed.

Start with `retained_t`: make it unconditional, and add the mode to it. That is the root of
the Phase 1 work and everything else depends on it.

**Context needed**
- `sunbnb-hw/experiments/005-wifi-transaction-energy/README.md` §8, §9 — the measured
  figures, **and two recorded constraints in §8 that shape this work** (see Phase 1)
- `sunbnb-hw/firmware/device/main/main.c` — the `#if CONFIG_SUNBNB_DEEP_SLEEP` /
  `CONFIG_SUNBNB_LIGHT_SLEEP` structure, and the `retained_t` comments explaining why each
  retained field is load-bearing *together*
- `sunbnb-hw/firmware/device/main/api.h` — `poll_result_t.poll_after_sec`,
  `telemetry_t.batt_mv`; the wire already carries both directions of what this needs
- `sunbnb-hw/firmware/device/sdkconfig.bench` — the console-on-UART0 config that exists
  *because* of the light-sleep constraint below

**Blocked by** nothing.

## Roadmap

### ✅ Phase 0 — the measurements already exist

Closed on creation day. The figures were taken in exp 005 sessions 2–4 (2026-08-18) and the
band boundaries in the Goal fall out of them directly. **The trap was in exp 005's own
summary line**, which quotes a projection where the measurement says otherwise — see D4.

| | Measured | Source |
|---|---|---|
| Association upkeep, cadence-independent | **4.97 mA** | §9, two agreeing 60 s captures |
| Poll on an open connection | **0.00133 mAh** | §9, integrated |
| Cold connect-poll (wake) | **0.038 mAh** over 4.56 s | §2, *derived* not integrated |
| Continuous, colour indicator | **~5.5 mA**, rolling 4–7 | §10 |
| Light-sleep floor between beacon wakes | **240 µA** | §9 |

**Crossover, deep sleep versus staying associated: ~27 s** at the measured wake. Beacon
maintenance is ~72 % of the associated figure and is **AP-side** — DTIM 1 on a repeater
mesh forces a wake every 102 ms whatever `listen_interval` asks — so light sleep is roughly
flat with cadence, while deep sleep scales with it. That is exactly why the bands are shaped
as they are.

### ☐ Phase 1 — make the sleep path runtime-selectable

**Two constraints recorded in exp 005 §8 bind this work, and both are easy to rediscover
the hard way:**

**USB Serial/JTAG console and light sleep are mutually exclusive on the C6.** Nothing holds
a power-management lock for the default polling console, so once the chip sleeps the
peripheral is clock-gated and traffic is lost — while enumeration survives, so **it presents
as a hang, not a console fault**. `sdkconfig.bench` exists to route the console to UART0 for
this reason. Note that `sunbnb-hw`'s working `sdkconfig` was regenerated on 2026-09-08 with
USB-Serial-JTAG as the primary console (to get an interactive prompt for disc calibration),
so anyone testing light sleep on the current config will see a dead console first.

**Light sleep floats every GPIO** — `sleep_gpio: Configure to isolate all GPIO pins in
sleep state`. §8 flags this as fatal for a high-side LED gate; it now applies to the
**DRV8833's `STBY`** if that is ever driven from a GPIO to save its ~2.5 mA. Needs
`gpio_hold_en()` on the pin, or the isolation option disabled, before anything runs on cells.

**The structural core, and nearly all the work.** **Deep sleep exits through a reset**:
continuous and light sleep continue the loop in RAM, deep sleep re-runs `app_main` with
only RTC memory surviving. So the loop must be able to either continue or never return,
chosen at runtime.

- ☐ `retained_t` becomes **unconditional** — it is `#if CONFIG_SUNBNB_DEEP_SLEEP` today. If
  deep sleep is reachable at runtime, every field must be maintained always. Free at
  runtime; careful work, in the file whose comments explain why the fields are
  load-bearing *together*.
- ☐ **Mode joins the retained state**, or the device forgets what it was doing across a sleep.
- ☐ Both sleep paths compile in; branch at the bottom of the poll loop.
- ☐ Light sleep on/off via `esp_pm_configure()` at runtime.
- ☐ Re-examine `api_forget_etag()`'s `if (!s_resumed)` rule — "resumed" stops being a clean
  binary when a device that was in light sleep enters deep sleep for the first time.
- ☐ Re-check `indicator.c`'s `esp_sleep_get_wakeup_cause()` branch, the second place that
  assumes the boot/wake distinction.

### ☐ Phase 2 — the wire

- ☐ Decide how the mode reaches the device (see **Open decisions**).
- ☐ Server-side policy: which mode for which venue, at which hours, on what battery.
- ☐ **Hysteresis belongs on the server.** Each deep-sleep entry and exit costs a boot;
  a device flipping modes every poll would be worse than either mode alone.

### ☐ Phase 3 — continuous mode

- ☐ 1–15 s cadence with connection reuse, so a poll is ~0.00133 mAh rather than a rejoin.
- ☐ Only worth building once Phases 0–2 prove the frame.

### 💤 Backlog

- Push transport (websockets) for the 1 s end. Needs an ADR 0008 amendment.

## Open decisions

**D1 — Does the server send the mode, or does the device infer it from cadence?**
Inferring costs no new wire field: 1–15 s → continuous, 60 s+ → deep. But the bands
*overlap* at 10–15 s and 60 s, and the overlap is where the interesting decisions live —
"60 s, but stay associated because a change is expected" is not expressible as a number.
Leaning toward an explicit field, with cadence still carried by `poll_after_sec`.

**D2 — Is up to one interval of escape latency acceptable?** A sleeping device cannot be
reached, so leaving deep sleep always waits for the next scheduled wake. "The venue got
busy" therefore takes up to one deep-sleep interval to take effect. Almost certainly fine;
worth stating rather than discovering.

**D3 — Does battery level feed the mode at all, or only the cadence?** `telemetry_t.batt_mv`
already reports it, so a server-side rule needs no device change. Note that **LiFePO4's flat
discharge curve makes voltage a poor graduated signal** — it sits near 3.3 V across most of
its capacity. The charger's `CHRG`/`DONE` pins would be a better input (two GPIOs, no ADC,
and a more direct measure of energy *balance* than voltage), but that is a hardware change.

**D4 — Is the fast-join cache worth chasing?** The ~27 s crossover comes from the *measured*
4.56 s wake. exp 005 §2 estimates a realistic optimised wake at ~1.5 s, which would move the
crossover to ~9 s and make deep sleep the cheaper choice across almost the whole light-sleep
band. `wifi.c` already caches BSSID and channel for a pinned join; whether it delivers has
never been measured, and §4 still lists "integrate the boot hump properly" as outstanding.
**This is an optimisation, not a gate** — the bands are correct as measured, and would only
shift if someone does the work.

## Log

**2026-09-11 — created.** Arose from a device-side session on the disc indicator. The
triggering observation: 15 s versus 60 s response time is product-visible, and cadence alone
cannot cross the mode boundary.

**2026-09-11 — Phase 0 closed on the same day, on review of exp 005.** The track opened by
proposing to measure the wake energy. The measurements already existed; what did not was a
correct reading of them.

exp 005 §9's headline — *"crossover ≈ 10 s, rejoin wins at any sane cadence"* — is computed
from the **estimated optimised** wake of 1.5 s, not the 4.56 s that was actually measured.
Against the measured figure the crossover is **~27 s**, and the difference is not academic:
at 15 s the summary implies deep sleep wins when in fact light sleep does.

That corrected number is what makes the three bands fall out of the data rather than out of
judgement — light sleep is roughly flat with cadence because its cost is AP-side beacon
maintenance, deep sleep scales with cadence, and they cross around 27 s. Hence: continuous
below ~10 s where deep sleep cannot reach, light sleep 10–27 s, deep sleep beyond.

Two constraints from §8 were also surfaced and moved into Phase 1, having been recorded once
and then not carried forward: **light sleep is incompatible with the USB-Serial-JTAG
console** (presents as a hang), and **light sleep floats every GPIO**, which now threatens
the DRV8833's `STBY` pin rather than the retired LED gate.

Lesson worth keeping: the summary line of an experiment can quote a projection while its own
tables hold the measurement. Read the tables.

## Links

- [[track:019-hw-api]] — the wire contract this extends
- ADR 0008 (`sunbnb-hw`) — why the device polls; the transport this stays inside
- exp 005 (`sunbnb-hw`) — every energy figure here, and the outstanding integration work
