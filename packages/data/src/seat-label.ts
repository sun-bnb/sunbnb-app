/**
 * Seat-label computation for InventoryItems.
 *
 * Label format: `{parcel}-{row}{groupSeq:02}-{member}`
 *   e.g.  2-302-1  = parcel 2, row 3, 2nd unit in that row, member 1
 *
 * Decoding `InventoryItem.number` (an encoded Int):
 *   parcel  = Math.floor(number / 10000)   — matches item.group
 *   row     = Math.floor(number / 100) % 100
 *   seatIdx = number % 100                 — left→right order within the row
 *
 * A "unit" within a (parcel, row) bucket is:
 *   - A SunbedGroup (sunbedGroupId is non-null): all members sharing the same groupId
 *   - A singleton: an ungrouped item (sunbedGroupId === null), treated as its own unit
 *
 * Units are ordered by their minimum seatIdx (left→right). Within a unit,
 * members are ordered by seatIdx. The resulting ordinal position gives
 * groupSeq (1-based, zero-padded to 2 digits) and member (1-based).
 */

// Pure module — NO database imports. The DB-backed recomputeSeatLabels /
// backfillAllSeatLabels live in `./seat-label-db` so client components can
// import the display helpers (formatSeat) without pulling `pg` into the bundle.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeatLabelItem {
  id: string
  number: number
  group: number
  sunbedGroupId: string | null
  /**
   * The unit's PERSISTED ordinal (track 021 P3). When present it is used
   * verbatim, so inserting or removing a neighbouring unit cannot rename this
   * one — the number painted on the bed does not move, so neither should the
   * label. Null means "not assigned yet"; those units fall back to positional
   * order, which is exactly what every unit did before P3.
   */
  unitSeq?: number | null
  /**
   * Needed to tell a PLACED seat from a `pool` extra. A unit's address is
   * derived from its placed seats only: `nextPoolNumber` mints pool numbers
   * that decode to a different row than the unit the extra hangs off, so
   * counting them makes the address ambiguous (observed on real data — three
   * such units in the dev DB, none yet in test or production).
   *
   * Optional so existing callers that only want labels are unaffected; absent
   * is treated as placed, which is what every seat was before pool extras.
   */
  status?: string | null
}

/**
 * A unit's position, and therefore its identity (track 021). `{parcel}-{row}-{seq}`
 * is the address painted on the bed and typed into a device assignment.
 */
export interface UnitAddress {
  parcel: number
  row: number
  seq: number
}

// ---------------------------------------------------------------------------
// Pure compute
// ---------------------------------------------------------------------------

/**
 * Compute seat labels for a collection of inventory items.
 * Pure function — no DB access.
 *
 * @returns Map<itemId, label>
 */
export function computeSeatLabels(items: SeatLabelItem[]): Map<string, string> {
  return computeSeatLabelsWithUnits(items).labels
}

/**
 * Same computation, but also returns the ordinal each unit ended up with
 * (track 021 P3). The DB layer persists the ones that were not already stored,
 * which is how a unit's number becomes durable: assigned once from today's
 * positional order, then read verbatim forever after.
 */
export function computeSeatLabelsWithUnits(items: SeatLabelItem[]): {
  labels: Map<string, string>
  unitSeqs: Map<string, number>
  /**
   * The full address per unit (track 021), for units whose position can be
   * derived confidently. A unit is ABSENT when it holds no placed seat (nothing
   * physical to name) or when its placed seats disagree about parcel or row —
   * writing a half-right address would silently re-point whatever device is
   * bound to it, so we decline instead, the same way the HW route declines
   * rather than resolving doubt toward FREE.
   */
  unitAddresses: Map<string, UnitAddress>
} {
  // kb: decision — using item.group as the parcel rather than re-deriving
  // Math.floor(number/10000) because group IS the parcel and is already
  // available on the item record; no risk of disagreement if number encoding
  // ever changes.

  // 1. Bucket items by (parcel, row)
  type BucketKey = `${number}:${number}`
  const buckets = new Map<BucketKey, SeatLabelItem[]>()

  for (const item of items) {
    const parcel = item.group
    const row = Math.floor(item.number / 100) % 100
    const key: BucketKey = `${parcel}:${row}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(item)
  }

  const result = new Map<string, string>()
  const unitSeqs = new Map<string, number>()
  // Ordinal per (bucket, unit) rather than per unit. A unit with a pool extra
  // appears in TWO buckets — the extra's synthetic number puts it in another
  // row — and the address must take the ordinal from the bucket its PLACED
  // seats are in, which is also the one their labels use.
  const bucketSeqs = new Map<string, number>()

  for (const [key, bucketItems] of buckets) {
    const [parcelStr, rowStr] = key.split(':')
    const parcel = Number(parcelStr)
    const row = Number(rowStr)

    // 2. Group items into units within this bucket.
    // kb: decision — singleton ungrouped items use the item.id as unit key so
    // that each ungrouped seat gets its own sequential groupSeq slot. Using a
    // common sentinel like 'null' would collapse all ungrouped seats in a row
    // into one unit, which is wrong: they may be physically separate chairs.
    type UnitKey = string
    const unitMap = new Map<UnitKey, SeatLabelItem[]>()

    for (const item of bucketItems) {
      const unitKey: UnitKey = item.sunbedGroupId ?? `__solo_${item.id}`
      if (!unitMap.has(unitKey)) unitMap.set(unitKey, [])
      unitMap.get(unitKey)!.push(item)
    }

    // 3. Order units by minimum seatIdx (left→right).
    // kb: decision — min-seatIdx ordering is robust to non-contiguous group
    // members (e.g. group A occupies seats 1,3 and group B occupies seats 2,4
    // in the same row). A run-based approach would split such groups. Min-seatIdx
    // always picks one canonical representative per unit regardless of layout.
    const seatIdx = (item: SeatLabelItem) => item.number % 100
    const units = Array.from(unitMap.entries()).sort(([, aItems], [, bItems]) => {
      const aMin = Math.min(...aItems.map(seatIdx))
      const bMin = Math.min(...bItems.map(seatIdx))
      return aMin - bMin
    })

    // 4. Assign groupSeq + member.
    //
    // Track 021 P3: a unit with a persisted `unitSeq` keeps it. Units without
    // one (not yet assigned) fill the remaining ordinals in positional order,
    // skipping any already taken — so a mixed bucket stays collision-free and a
    // fully-unassigned bucket reproduces the pre-P3 numbering exactly.
    //
    // A persisted ordinal is honoured only if no EARLIER unit in this bucket
    // already claimed it. Two units holding the same `seq` used to both keep it
    // and emit an identical label; that cannot happen in any environment's data
    // today (checked before this shipped), but a rearrange that moves a unit
    // into a row where its ordinal is already spoken for would produce it — and
    // once UNIQUE(site, parcel, row, seq) exists, a duplicate stops being a
    // cosmetic label clash and becomes a failed write. Positional order decides
    // the winner, so the outcome does not depend on row order from the DB.
    const persistedOf = (members: SeatLabelItem[]) =>
      members.find((m) => m.unitSeq != null)?.unitSeq ?? null
    const taken = new Set<number>()
    const keepsPersisted = units.map(([, members]) => {
      const persisted = persistedOf(members)
      if (persisted == null || taken.has(persisted)) return false
      taken.add(persisted)
      return true
    })
    let nextFree = 1
    const ordinalFor = (members: SeatLabelItem[], index: number): number => {
      if (keepsPersisted[index]) return persistedOf(members)!
      while (taken.has(nextFree)) nextFree++
      taken.add(nextFree)
      return nextFree
    }

    for (let i = 0; i < units.length; i++) {
      const groupSeq = ordinalFor(units[i]![1], i)
      bucketSeqs.set(`${key}|${units[i]![0]}`, groupSeq)
      const unitKey = units[i]![0]
      // Only real units get a persisted ordinal; `__solo_` keys are the
      // synthetic buckets for seats that have no unit row at all.
      if (!unitKey.startsWith('__solo_')) unitSeqs.set(unitKey, groupSeq)
      const [, members] = units[i]!
      // Order members left→right by seatIdx
      const sortedMembers = [...members].sort((a, b) => seatIdx(a) - seatIdx(b))
      for (let j = 0; j < sortedMembers.length; j++) {
        const member = j + 1 // 1-based
        const label = `${parcel}-${row}${String(groupSeq).padStart(2, '0')}-${member}`
        result.set(sortedMembers[j]!.id, label)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Unit addresses (track 021)
  //
  // Deliberately a separate pass over units rather than a by-product of the
  // bucket loop: the bucket loop is driven by every seat, and a unit's address
  // must be driven only by its PLACED ones.
  // ---------------------------------------------------------------------------
  const unitAddresses = new Map<string, UnitAddress>()
  const placedByUnit = new Map<string, SeatLabelItem[]>()
  for (const item of items) {
    if (!item.sunbedGroupId) continue
    if (item.status === 'pool') continue
    if (!placedByUnit.has(item.sunbedGroupId)) placedByUnit.set(item.sunbedGroupId, [])
    placedByUnit.get(item.sunbedGroupId)!.push(item)
  }

  for (const [unitId, members] of placedByUnit) {
    const parcels = new Set(members.map((m) => m.group))
    const rows = new Set(members.map((m) => Math.floor(m.number / 100) % 100))
    // Seats of one unit that disagree about where they are. Decline rather than
    // pick one — see the doc on `unitAddresses`.
    if (parcels.size !== 1 || rows.size !== 1) continue

    const parcel = members[0]!.group
    const row = Math.floor(members[0]!.number / 100) % 100
    const seq = bucketSeqs.get(`${parcel}:${row}|${unitId}`)
    if (seq == null) continue

    unitAddresses.set(unitId, { parcel, row, seq })
  }

  return { labels: result, unitSeqs, unitAddresses }
}

// ---------------------------------------------------------------------------
// Format helper
// ---------------------------------------------------------------------------

/**
 * Format a stored seatLabel for display.
 *
 * @param label   The stored seatLabel value (may be null / empty string).
 * @param options `parcel: false` strips the leading "{parcel}-" segment so only
 *                the within-parcel portion is shown (e.g. "302-1" instead of
 *                "2-302-1"). Defaults to `true` (full label).
 * @returns Formatted string, or '' if label is null/empty.
 */
export function formatSeatLabel(
  label: string | null | undefined,
  options: { parcel?: boolean } = {},
): string {
  if (!label) return ''
  const { parcel = true } = options
  if (parcel) return label
  // Strip the first segment: everything up to and including the first '-'
  const dashIdx = label.indexOf('-')
  return dashIdx === -1 ? label : label.slice(dashIdx + 1)
}

/** The four numbers a seat label carries, unpacked. */
export interface SeatAddress {
  parcel: number
  row: number
  seq: number
  member: number
}

/**
 * Unpack a stored `seatLabel` into its four numbers.
 *
 * The stored form packs row and unit ordinal into ONE segment —
 * `{parcel}-{row}{seq:02}-{member}`, so `1-101-1` is parcel 1, row 1, unit 1,
 * bed 1. `seq` is always zero-padded to exactly two digits, which is what makes
 * the split unambiguous however many digits the row has: the last two are the
 * ordinal, whatever precedes them is the row.
 *
 * Parsing rather than carrying the unit's stored `parcel`/`row`/`seq` columns in
 * the payload is deliberate: the label already holds every number, and the
 * inventory tab was cut from 5,487KB to 87KB by NOT shipping per-seat unit data
 * (track 020 C2). This is presentation over data already present.
 *
 * Returns null for a missing or unrecognised label; callers fall back to the
 * legacy number rather than showing a mangled id.
 */
export function parseSeatLabel(label: string | null | undefined): SeatAddress | null {
  if (!label) return null
  const parts = label.split('-')
  if (parts.length !== 3) return null

  const [parcelPart, middle, memberPart] = parts as [string, string, string]
  // At least one row digit plus the two ordinal digits.
  if (middle.length < 3) return null

  const address = {
    parcel: Number(parcelPart),
    row: Number(middle.slice(0, -2)),
    seq: Number(middle.slice(-2)),
    member: Number(memberPart),
  }
  const values = [address.parcel, address.row, address.seq, address.member]
  if (values.some((n) => !Number.isInteger(n) || n < 0)) return null
  return address
}

/**
 * Decode `InventoryItem.number` into the position it packs.
 *
 * The encoding is `parcel * 10000 + row * 100 + seatIdx`, and pool extras use
 * the same per-parcel block with row 99 (see `nextPoolNumber`).
 *
 * Exported because consumers kept re-deriving it, and the manage grid derived
 * it by SLICING THE STRING — `str[0]` as the parcel, `str[1..3]` as the row.
 * That silently caps a site at NINE parcels: every parcel from 10 up collapses
 * into a single-digit bucket and drags a misread row and position with it.
 * Arithmetic has no such ceiling, which is the whole reason the number is
 * packed this way rather than concatenated.
 */
export interface DecodedSeatNumber {
  parcel: number
  row: number
  /** Position within the row, left to right. 1-based. */
  seatIdx: number
}

export function decodeSeatNumber(number: number): DecodedSeatNumber {
  return {
    parcel: Math.floor(number / 10000),
    row: Math.floor(number / 100) % 100,
    seatIdx: number % 100,
  }
}

/**
 * The seat id as a person reads it: `{parcel}-{row}-{seq}-{member}` — the UNIT
 * ADDRESS followed by which bed under it (track 021).
 *
 * The unit address is a literal prefix, which is the whole point: a device is
 * assigned to `1-1-1`, and staff need to see at a glance that beds `1-1-1-1` and
 * `1-1-1-2` are the ones under that parasol. The packed storage form (`1-101-1`)
 * hides exactly that relationship.
 *
 * Display only — the stored `seatLabel` is untouched, so nothing a device
 * resolves and nothing already printed or painted changes meaning.
 * `parcel: false` omits the leading parcel, for contexts already scoped to one.
 */
export function formatSeatId(
  item: { seatLabel?: string | null; number: number },
  options: { parcel?: boolean } = {},
): string {
  const address = parseSeatLabel(item.seatLabel)
  if (!address) return formatSeat(item, options)

  const { parcel = true } = options
  const head = parcel ? `${address.parcel}-` : ''
  return `${head}${address.row}-${address.seq}-${address.member}`
}

/**
 * Display formatter for a seat: prefer the structured `seatLabel`, falling back
 * to the legacy zero-padded `number` when a seat has no label yet (e.g. created
 * by old code before a recompute). Use this at every place a seat number is
 * shown to a user. `parcel: false` omits the leading "{parcel}-" segment.
 */
export function formatSeat(
  item: { seatLabel?: string | null; number: number },
  options: { parcel?: boolean } = {},
): string {
  if (item.seatLabel) return formatSeatLabel(item.seatLabel, options)
  return String(item.number).padStart(4, '0')
}
