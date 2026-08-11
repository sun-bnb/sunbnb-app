# Reservation state machine — intended model (track 018, P1)

Drafted 2026-08-11 from the P1 review session (founder decisions locked — see §6).
Companion to `018-state-machine-defacto.md` (what the code does today). This document is
the **contract for P2**: the transition table below becomes data, `applyTransition` becomes
its interpreter, and the matrix tests are generated from it. **Anything not listed as an
allowed transition is a must-reject cell.**

## 1. The state tuple

`deriveState(reservation) → S = (kind, pay, occ, ctx)` — ONE exported function; the grid,
every guard, and every test read state only through it. Kind is **derived** (no migration)
from the stored tuple; storage stays as-is.

| Axis | Values | Derived from |
|------|--------|--------------|
| `kind` | online · walkin · hold · comp · block | status × operationalStatus × isComp (defacto §2 table) |
| `pay` (online) | pending · processing · complete · payment_failed · canceled · refunded | status |
| `pay` (walkin) | unsettled · settled · collecting · collected · refunded | status + non-voided TillEntry presence (settled) + paymentRef (collecting=processing; collected=complete) |
| `pay` (hold/comp/block) | — (zero-money kinds) | |
| `occ` (per civil day, venue TZ) | expected · present · departed · no-show (block: —) | ReservationDay today-row ?? parent, via deriveState only |
| `ctx` | hasFutureDays · stayOver · seats[] · settledAmount · receiptTotal | computed |

Notes:
- `present` unifies checked-in (online) and walked-in (cash) — same occupancy, different
  kind. The stored column keeps both strings; deriveState maps them.
- `collecting`/`collected` are **phases of walkin**, not a separate kind (defacto K3 folded).
- No new status strings. Cash refund terminates as `refunded` with `paymentRef = null`.

## 2. Global invariants (checked by generated property tests)

- **I1 Till conservation.** Over a split lineage: Σ non-voided TillEntry == Σ settled
  paymentAmounts. Splits partition, never create or destroy till money.
- **I2 Receipt conservation.** Over a lineage: Σ receipt invoices − Σ credit notes ==
  Σ non-voided TillEntry. Receipts never deleted (hash chain); corrections are credit notes.
- **I3 Seat partition.** A split partitions `items[]`; disconnect/connect never lose or
  duplicate a seat.
- **I4 Deletable rule.** A reservation row may be hard-deleted **iff** it has never had a
  TillEntry or invoice. Money rows terminate in states; they are never deleted (unreserve,
  cron, abandon included).
- **I5 Single writer.** No state-field write outside `applyTransition`; no occupancy write
  outside `applyDayTransition` (which it calls). Meta-guard source-scan test enforces.
- **I6 One clock.** All day math venue-local (`site-day.ts`); the availability guard, cron,
  and grid share deriveState's release rule: released ⇔ occ ∈ {departed, no-show} ∧ stayOver.
- **I7 DB-priced.** Every amount written is computed from DB prices or partitioned from an
  existing DB-derived amount (no-inline-money remains in force).

## 3. Transition table

Legend: pre/post as `kind·pay·occ` (· = unchanged/any within kind). Effects are named keys
(the P2 effect vocabulary). Unlisted (event × state) ⇒ REJECT (matrix-asserted).

### Create events
| Event | Pre | Post | Effects |
|---|---|---|---|
| consumer.book (paid site) | seats free | online·pending·expected | conflictGuardCreate, priceFromDb |
| consumer.book (free site) | seats free | online·complete·expected | conflictGuardCreate |
| staff.walkIn (cash) | seats free | walkin·settled·present | conflictGuardCreate, priceFromDb, tillRecord, receiptIssue |
| staff.walkIn (card, unsettled) | seats free | walkin·unsettled·present | conflictGuardCreate, priceFromDb |
| staff.hold | seats free | hold·—·expected | conflictGuardCreate |
| staff.comp | seats free | comp·—·present | conflictGuardCreate (isComp, amount 0) |
| staff.block | seats free (window [today,∞)) | block·—·— | conflictGuardCreate (sentinel `to`; **status no longer implies paid** — kind test uses op only) |

Grouping: single-tap expands pair/group siblings; multiselect books exact ids (deliberate,
a parameter of the event — D13 kept).

### Payment events (online + walkin-collect share the rail)
| Event | Pre | Post | Effects |
|---|---|---|---|
| pay.initiate | online·pending·· | online·processing·· | mollieCreate, setPaymentRef |
| pay.initiate.fail | online·pending·· | online·payment_failed·· | — |
| collect.start | walkin·unsettled·present | walkin·collecting·present | amountFromDb (persist, no blind overwrite), mintAnonId, mollieCreate \| demoRef. **REJECT if settled** (D6) |
| pay.confirm (webhook/poll/reconcile/collect-poll) | ·{processing,collecting}·· | online·complete·· / walkin·collected·· | invoiceOnline (PARTNER+PLATFORM, idempotent), email |
| pay.fail (collect) | walkin·collecting·present | walkin·unsettled·present | clearPaymentRef |
| pay.fail (online) | online·processing·· | online·payment_failed·· | — |
| collect.abandon | walkin·collecting·present | walkin·unsettled·present | reverifyOnce (paid ⇒ pay.confirm path), mollieCancel, clearPaymentRef. **Never deletes** (D5) |
| pay.refund.webhook | online·complete·· | online·refunded·· | — |

### Cash events
| Event | Pre | Post | Effects |
|---|---|---|---|
| staff.settle | walkin·unsettled·{present,expected} | walkin·settled·= | tillRecord (staff amount, 0<a≤100k), receiptIssue |
| staff.unreserve+refund (whole) | walkin·settled·any | walkin·refunded·departed — **row kept** (I4) | tillVoid (all), creditNoteIssue (I2), dayRow(departed) |
| staff.unreserve (unsettled/hold-like whole) | walkin·unsettled·any | row deleted | delete (I4 permits) |
| staff.unreserve (seat, party >1) | walkin··present | seat disconnected; party unchanged | seatDisconnect, amountRepartition, tillPartition when settled (freed seat's share voided + credit-noted). Dialog shows exactly the voided share (D2) |

### Occupancy events (all via applyDayTransition; guards read deriveState only — D7/D9)
| Event | Pre | Post | Effects |
|---|---|---|---|
| staff.checkIn | online·complete·expected | online·complete·present | dayRow(present, checkedInAt). **complete only** (D10 — holds arrive via convert; mid-payment resolves via payment rail) |
| staff.resume | walkin·{settled,unsettled}·expected | walkin·=·present | dayRow(present, checkedInAt) |
| staff.resume (undo depart, same day) | walkin··departed (same civil day) | walkin·=·present | conflictRecheck (bed may be re-let), dayRow(present). New — re-entry decision |
| staff.depart (whole) | ·paid-or-settled·present | hasFutureDays ⇒ occ=expected (nulls) else occ=departed | dayRow; money untouched |
| staff.noShow | ··expected | ··no-show | dayRow. Kind-guarded: online·complete or walkin; a hold no-show = release |
| staff.move / moveToSeats | occ ∉ {departed, no-show} (via deriveState) | seats re-pointed | conflictGuardMove; identity/money/invoices preserved |

### Split events (one shared primitive — depart-split, seat-collect-split, hold-convert-split)
| Event | Pre | Post | Effects |
|---|---|---|---|
| split(subset) | walkin··present, subset ⊂ seats | original keeps rest; NEW walkin, same pay-phase, attribution copied | seatPartition (I3), amountRepartition (I7), **tillPartition** when settled: void original entry + recreate per-part entries preserving settledAt/employee (I1), lineageLink (`splitFromId`, additive nullable column — the one schema touch, P2), dayRowClone |
| convert(hold→walkin, whole) | hold·—·expected | walkin·{settled\|unsettled}·present | inPlaceKindChange **via applyTransition** (day-row updated atomically — D9), amountFromDb, tillRecord+receiptIssue when cash |
| convert(hold→walkin, subset) | hold, subset ⊂ seats | hold keeps rest; NEW walkin | = split effects with target kind walkin |

Split never runs on online·complete / collected (invoice complexity — unchanged rule).

### Release / end events
| Event | Pre | Post | Effects |
|---|---|---|---|
| staff.releaseHold / uncomp / unblock | hold/comp/block | delete (whole) or seatDisconnect (partial) | I4 always permits (zero-money kinds) |
| partner.cancel | online·complete·any | online·{refunded if refundedAt else canceled}·— row kept | dayRow(released) |
| partner.refund | online·complete·any | = (occupied!) + refundedAt | mollieRefund, idempotent |
| user.cancel | online·{pending,complete}· | online·canceled· | providerRefund if paid |
| staff.removeFailed | ·payment_failed· | delete | I4 (failed rows have no money) |
| cron.gc | pending/processing >15min ∧ occ ∉ present; failed >24h; expired zero-money rows (held, unsettled walkin, comp) | delete | I4 filter replaces status filter; **settled walk-ins survive** (terminate via stay-over release, stay queryable) |

## 4. What this fixes (D-list disposition)

D1 → split effects (tillPartition + I1/I2, lineage). D2 → dialog reads the effect cell.
D3 → creditNoteIssue + I2. D4 → `pay` axis reifies settled. D5 → collect.abandon never
deletes. D6 → collect.start reject-cell on settled. D7/D9 → I5 + deriveState-only guards +
applyTransition-atomic kind changes. D8 → I6 (guard adopts deriveState release rule, venue
TZ). D10 → kind-guarded occupancy events. D11 → kind derived; block's status quirk hidden
behind deriveState (storage untouched for now). D12 → I4 deletable rule. D13 → kept,
explicit event parameter.

## 5. P2 implementation notes (not design)

- Table as typed const in `@repo/data/src/reservation-machine.ts` (Q3: data package —
  cron + consumer app transition too); effects interpreter beside it; `deriveState` exported
  for partner grid (replaces bed-state internals; bed-state.ts becomes presentation only).
- Matrix tests generated from the table (auth-matrix pattern) + property tests for I1–I7.
- Meta-guard: source scan rejecting `reservation.update/delete` on state fields outside the
  machine module (no-inline-money pattern).
- One additive schema touch: `Reservation.splitFromId` (nullable self-ref) for lineage.
  Expand-only; follows migrations.md.
- Migration of actions is incremental: each action swaps its guard+writes for an
  `applyTransition` call; bug-ledger cells go red-first in the matrix.
- Scope (Q5): sunbed reservations. Rentals/tables later on the same rails.

## 6. Decision record (founder, 2026-08-11 P1 review)

1. **Till on split → partition:** void original entry + recreate parts preserving
   settledAt/employee (append-only audit).
2. **Cash refund receipts → credit note** (extends track 015 deferred item).
3. **Row lifecycle → money rows kept** (I4); zero-effect rows stay deletable.
4. **Same-day departed cash walk-in → re-seatable** (resume-undo with conflict recheck).
5. Accepted as stated in review (no veto): D5 abandon-reverts-never-deletes; D10 check-in
   requires `complete`; D13 grouping kept as event parameter; Q3 machine in `@repo/data`;
   Q5 sunbeds-first.
6. Claude's calls (reversible, flagged): kind derived not persisted; no new status strings
   (cash refund reuses `refunded`, paymentRef null ⇒ cash).
