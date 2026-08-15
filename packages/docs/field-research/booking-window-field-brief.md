# Field Brief — Online Booking-Window ("shift open time") Functionality

> **What this is.** External field research, not app documentation — placed here (with the founder's express permission) so the product session can contrast this app's capabilities against a real competitor deployment. Authored in the sibling business repo; source material and evidence live there:
> - `../sunbnb-company/.claude/wiki/sources/emsa-limit-api.md` — how the competitor's API was read
> - `../sunbnb-company/.claude/wiki/entities/emsa-alcudia.md` — the operator
> - `../sunbnb-company/raw/emsa-alcudia-online-config-2026-08-14.json` — raw config snapshot
>
> **Origin:** reverse-engineered from Alcúdia / EMSA's Límit-built beach booking system (a direct competitor), 2026-08-14. Schema references below were checked read-only against this repo on 2026-08-14 — **re-verify against current schema before acting.**

---

## 1. What was observed in the field

EMSA's beach booking backend exposes these configuration values (read live 2026-08-14):

| Config key | Value | Meaning |
|---|---|---|
| `HORA_INICI_WEB` | `18:00` | Time the **online channel opens** each day |
| `HORA_FINAL_WEB` | `06:00` | Time the **online channel closes** each day |
| `HORA_ARQUEIG_WEB` | `01:00` | Nightly **till-close / reconciliation** cutoff (*arqueig* = cash count) |
| `DATA_INICI_RESERVES` | `2026-06-01` | Season **opens** |
| `DATA_FINAL_RESERVES` | `2026-10-01` | Season **closes** |

**Observed behaviour:** guests can book online only **18:00 → 06:00** — reserve tonight for a future day. During beach operating hours (**06:00 → 18:00**) the online channel is **shut**; daytime demand is walk-up only. Nightly reconciliation at 01:00.

The physical beach is open all day. So the online channel's open window is a **separate axis** from the venue's physical operating hours — and by design they do not coincide.

**Why they might do it (hypotheses, unconfirmed — for analysis, not fact):**
- **Conflict avoidance / batch reconciliation.** Their system has no real-time state at the sunbed; walk-ins aren't entered live. Freezing the online list overnight lets staff set up reserved sunbeds each morning against a stable list, and prevents same-day online bookings colliding with walk-ins staff can't see on a very large beach.
- **Single operating mode** — physical/manual by day, digital by night.
- **Cruder than the goal needs** — a global open/close clock is one config pair; "disable only *today's* date, keep future dates open" is bespoke logic they may simply not have built.

Whichever it is, the closed daytime window is **downstream of not having real-time state at the unit** — the gap Sunbnb's parasol-status / real-time model is meant to close.

---

## 2. Functional decomposition — four independent axes

"Hours" hides four separable controls. A good implementation keeps them distinct:

| Axis | Question it answers | EMSA's version |
|---|---|---|
| **A. Physical operating hours** | When is the venue open on the ground? | (not in this config — beach is all-day) |
| **B. Online channel window** | When can a guest **transact online**? | `HORA_INICI_WEB` / `HORA_FINAL_WEB` → 18:00–06:00 |
| **C. Booking lead time / same-day rule** | How far ahead / how late may a booking be made for a target date? | Implicit — night-only channel ⇒ all bookings next-day+ |
| **D. Daily / seasonal cutoffs** | When does the day's ledger close; when does the season run? | `HORA_ARQUEIG_WEB` 01:00; `DATA_INICI/FINAL_RESERVES` |

EMSA **conflates B and C** — they get "no same-day" only as a *side effect* of a night-only channel. A better product keeps them independent: an operator might disable same-day booking while keeping the channel open all day for future dates, or vice versa. Collapsing them is the incumbent's limitation, not a target to copy.

---

## 3. Current state in this repo (gap analysis)

Checked read-only 2026-08-14; **re-verify.**

| Axis | Exists today? | Where |
|---|---|---|
| **A. Physical operating hours** | **Yes** | `SiteWorkingHours` (`packages/data/prisma/schema.prisma:290`) — per-`day` `openTime`/`closeTime` (DateTime); `Site.timeZone` (IANA). Restaurant side: `RestaurantHours` (`"HH:mm"`) + `RestaurantShift`. |
| **B. Online channel window** | **No** — appears absent | No concept of "when the online channel is transactable" distinct from physical hours. The net-new axis. |
| **C. Lead time / same-day** | **Partial** | Restaurant `reservationWindow Int @default(60)` (`schema.prisma:844`) = days-ahead horizon; `cancellationDeadlineHours`. No same-day cutoff / minimum-lead found for **sunbed Sites**. |
| **D. Daily/seasonal cutoffs** | **No / partial** | No "daily ledger cutoff" (arqueig) concept; season likely encoded in availability data rather than an explicit window. |

**The gap:** this repo models *when the venue is physically open* (A) well. It does **not** model *when the online channel is open to transact* (B), a granular *same-day / minimum-lead rule* for sunbeds (C), or a *daily cutoff* (D).

---

## 4. Design considerations

Our differentiator is real-time state at the sunbed (QR status; roadmap LED), which **removes the need** for EMSA's defensive daytime blackout. So the design should be the opposite of theirs — optional and granular, defaulting to no artificial restriction:

1. **Model axis B explicitly** — an online-channel availability window per Site, independent of `SiteWorkingHours`. Default: **open whenever physically open** (no blackout — our advantage). Operator may override.
2. **Model axis C separately** — a minimum lead time and/or same-day toggle per Site/resource, so an operator can disable same-day online booking **without shutting the channel** for future dates — the thing EMSA structurally can't do.
3. **Timezone-correct** — reuse `Site.timeZone` / existing wall-clock handling (`src/site-day.ts`). Windows crossing midnight (18:00→06:00) must work.
4. **Per-resource-type ideally** — sunbeds, premium, rentals, F&B may want different windows (rentals hourly/same-day; sunbeds day-ahead).
5. **Season window (D)** — confirm whether an explicit `Site` season range beats encoding it in availability.
6. **Walk-up POS path** — decide whether lead/same-day rules apply there or only to online.

---

## 5. Data-model sketch (discussion, not prescription)

```
model Site {
  ...
  onlineWindowOpen   String?  // "HH:mm", null = follow physical hours (our default)
  onlineWindowClose  String?  // "HH:mm"; may be < open for overnight windows
  minLeadMinutes     Int?     // 0/null = same-day allowed up to start
  sameDayOnline      Boolean  @default(true)   // false = future-date only, channel still open
  seasonStart        DateTime?
  seasonEnd          DateTime?
}
```

A stays in `SiteWorkingHours`; B = `onlineWindow*`; C = `minLeadMinutes` + `sameDayOnline`; D = `season*` + optional daily-cutoff. **Four independent knobs, defaulting to "no artificial restriction."**

---

## 6. Open questions for analysis

1. Does `apps/user/app/api/sites/[id]/availability/route.ts` already gate by any time window beyond physical hours? Where's the hook.
2. Is `reservationWindow` (days-ahead) reusable for sunbed Sites, or restaurant-only today?
3. Should axis B live on `Site` or on a per-resource-type config?
4. Is there an existing "now"/cutoff concept in slot generation a same-day rule would plug into?
5. Does the walk-up POS path need the same lead/same-day rules?

---

## 7. Why this matters commercially (context)

EMSA's daytime blackout is a *symptom* of their architectural weakness, which we can turn into a differentiated capability: **always-open, same-day online booking during beach hours** — something the incumbent structurally cannot offer. The confirming question sits with the operator, not the code: the Alcúdia follow-up asks *why* their channel closes during the day, and his answer distinguishes "limitation they'd drop" from "operational choice they defend." Full competitive context: `../sunbnb-company/.claude/wiki/concepts/beach-booking-competitors.md`.
