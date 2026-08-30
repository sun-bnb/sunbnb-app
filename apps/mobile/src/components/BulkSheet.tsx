/**
 * Multiselect bulk-action sheet — RN port of the web manage view's bulk panel.
 * Verb availability comes from @repo/floor-core/bulk (the shared matrix);
 * execution semantics mirror the web: sequential per-seat/per-reservation
 * runners, all-or-nothing grouped creates, subset-aware convert/depart, and
 * the single-reservation rule for Card (QR).
 *
 * Non-modal by design: it overlays the bottom of the canvas, which stays
 * pannable and tappable (taps toggle the selection).
 */
import React, { useMemo, useState } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { RESERVATION_PAID_IN_CASH } from '@repo/data/reservation-status'
import { getActiveReservation } from '@repo/floor-core/bed-state'
import { classifySelection, getSelectionGroups } from '@repo/floor-core/bulk'
import type { InventoryItem } from '@repo/floor-core/types'
import CollectPaymentModal, { type CollectActions } from '@/components/CollectPaymentModal'
import { BanknoteIcon, BlockIcon, CalendarIcon, CloseIcon, MoveIcon, QrIcon, StarIcon } from '@/components/icons'
import { rpc, type ActionResult, type CollectChoice, type VivaTerminal } from '@/lib/api'
import { colors } from '@/theme'

const DAY_MS = 86_400_000
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

type ConfirmKind = 'no-show' | 'depart' | 'unreserve' | 'cancel'

export default function BulkSheet({
  siteId, accessKey, items, selectedIds, workerId, siteIsPaid,
  onClearSelection, onChanged, onStartMove, terminals = [], selectedTerminalId = null,
}: {
  siteId: string
  accessKey: string
  items: InventoryItem[]
  selectedIds: string[]
  workerId?: string
  siteIsPaid: boolean
  onClearSelection: () => void
  onChanged: () => void
  /** Enter move mode with the distinct reservation ids touched by the selection. */
  onStartMove: (reservationIds: string[]) => void
  terminals?: VivaTerminal[]
  selectedTerminalId?: string | null
}) {
  const cardLabel = terminals.length > 0 ? 'Card' : 'Card (QR)'
  const [guestName, setGuestName] = useState('')
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)
  const [collectTarget, setCollectTarget] = useState<string | null>(null)

  const sel = useMemo(() => classifySelection(items, selectedIds), [items, selectedIds])
  const groups = useMemo(() => getSelectionGroups(items, selectedIds), [items, selectedIds])
  const untilArg = until || undefined
  const nameArg = guestName.trim() || undefined

  // ── Runners (web-parity semantics) ─────────────────────────────────────
  async function guard<T extends ActionResult>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn()
    } catch {
      return null
    }
  }

  /** One grouped create — all-or-nothing on the server; conflict keeps the selection. */
  async function grouped(fn: () => Promise<ActionResult>) {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await guard(fn)
    setBusy(false)
    if (res?.status === 'ok') {
      onChanged()
      onClearSelection()
    } else {
      setError(res?.errors?.[0] ?? "Couldn't book — one or more selected sunbeds are already taken.")
    }
  }

  /** Sequential per-unit runner; partial failure keeps the selection with a count. */
  async function sequential(calls: (() => Promise<ActionResult>)[]) {
    if (busy) return
    setBusy(true)
    setError(null)
    let failed = 0
    for (const call of calls) {
      const res = await guard(call)
      if (res?.status !== 'ok') failed++
    }
    setBusy(false)
    onChanged()
    if (failed > 0) setError(`${failed} couldn't be updated`)
    else onClearSelection()
  }

  const bulkRentCash = () => {
    const calls: (() => Promise<ActionResult>)[] = []
    if (sel.freeIds.length > 0) {
      calls.push(() => rpc('reserveItems', [siteId, sel.freeIds, nameArg, undefined, accessKey, untilArg, workerId, true]))
    }
    for (const [resId, g] of groups) {
      if (!sel.heldReservationIds.has(resId)) continue
      calls.push(() =>
        rpc('convertHoldToWalkIn', [
          siteId, g.anyItemId, accessKey, nameArg, untilArg, workerId,
          !g.isSubset, g.isSubset ? g.selectedItemIds : undefined, true,
        ]),
      )
    }
    void sequential(calls)
  }

  const bulkRentCard = async () => {
    if (!sel.bulkCardEligible) {
      setError('Card payment works one booking at a time — select seats from a single reservation.')
      return
    }
    if (busy) return
    setBusy(true)
    setError(null)
    let res: (ActionResult & { reservationId?: string }) | null
    if (sel.freeIds.length > 0) {
      res = await guard(() =>
        rpc('reserveItems', [siteId, sel.freeIds, nameArg, undefined, accessKey, untilArg, workerId, false]),
      )
    } else {
      const [resId] = [...sel.heldReservationIds]
      const g = resId ? groups.get(resId) : undefined
      res = g
        ? await guard(() =>
            rpc('convertHoldToWalkIn', [
              siteId, g.anyItemId, accessKey, nameArg, untilArg, workerId,
              !g.isSubset, g.isSubset ? g.selectedItemIds : undefined, false,
            ]),
          )
        : null
    }
    setBusy(false)
    if (res?.status === 'ok' && typeof res.reservationId === 'string') {
      onChanged()
      setCollectTarget(res.reservationId)
    } else {
      setError(res?.errors?.[0] ?? 'Something went wrong')
    }
  }

  const bulkCheckIn = () => {
    const calls: (() => Promise<ActionResult>)[] = []
    for (const [resId, g] of groups) {
      const item = items.find(i => i.id === g.anyItemId)
      const r = item ? getActiveReservation(item) : null
      if (!r || r.id !== resId) continue
      calls.push(() =>
        r.status === RESERVATION_PAID_IN_CASH
          ? rpc('resumeWalkIn', [siteId, resId, accessKey])
          : rpc('checkInReservation', [siteId, resId, accessKey]),
      )
    }
    void sequential(calls)
  }

  const bulkDepart = () => {
    const calls = [...groups.entries()].map(([resId, g]) => () =>
      rpc('markDeparted', g.isSubset
        ? [siteId, resId, accessKey, g.selectedItemIds]
        : [siteId, resId, accessKey]),
    )
    void sequential(calls)
  }

  const bulkNoShow = () =>
    void sequential([...groups.keys()].map(resId => () => rpc('markNoShow', [siteId, resId, accessKey])))

  const bulkCancel = () =>
    void sequential([...groups.values()].map(g => () => rpc('cancelReservation', [siteId, g.anyItemId, accessKey])))

  const bulkFree = () => {
    if (sel.canCashRelease) {
      const calls: (() => Promise<ActionResult>)[] = []
      for (const g of groups.values()) {
        if (g.isSubset) {
          for (const itemId of g.selectedItemIds) {
            calls.push(() => rpc('unreserveItem', [siteId, itemId, accessKey, false, true, workerId]))
          }
        } else {
          calls.push(() => rpc('unreserveItem', [siteId, g.anyItemId, accessKey, true, true, workerId]))
        }
      }
      void sequential(calls)
      return
    }
    const seenRes = new Set<string>()
    const calls: (() => Promise<ActionResult>)[] = []
    for (const id of selectedIds) {
      const item = items.find(i => i.id === id)
      if (!item) continue
      const kind = sel.homogeneousKind
      if (kind === 'blocked') calls.push(() => rpc('unblockBed', [siteId, id, accessKey, false]))
      else if (kind === 'comp') calls.push(() => rpc('uncompBed', [siteId, id, accessKey, false]))
      else if (kind === 'held') calls.push(() => rpc('releaseHold', [siteId, id, accessKey, false]))
      else if (kind === 'failed') {
        const r = getActiveReservation(item)
        if (r && !seenRes.has(r.id)) {
          seenRes.add(r.id)
          calls.push(() => rpc('removeFailedReservation', [siteId, r.id, accessKey]))
        }
      }
    }
    void sequential(calls)
  }

  const runConfirm = () => {
    const kind = confirm
    setConfirm(null)
    if (kind === 'no-show') bulkNoShow()
    else if (kind === 'cancel') bulkCancel()
    else if (kind === 'depart') bulkDepart()
    else if (kind === 'unreserve') bulkFree()
  }

  const confirmCopy =
    confirm === 'no-show'
      ? 'Marking as a no-show — the guest never arrived. The payment is kept; the seats free up.'
      : confirm === 'depart'
        ? 'Marking as departed. The payment is kept; the seats free up.'
        : confirm === 'cancel'
          ? 'Cancelling these reservations frees the seats.'
          : sel.refundTotal > 0
            ? `Refunding €${sel.refundTotal.toFixed(2)} across the selection — removed from the till; hand the cash back. The seats free up.`
            : 'Ending these walk-ins — the seats free up.'

  const startMove = () => onStartMove([...groups.keys()])

  const moveSquare = (
    <Pressable style={styles.square} onPress={startMove} disabled={busy}>
      <MoveIcon />
      <Text style={styles.squareLabel}>Move</Text>
    </Pressable>
  )

  const showHeldRent = sel.canRent && !sel.allAvailable
  const dominantRow = sel.allAvailable || showHeldRent || sel.canCheckIn || sel.canDepart

  const freeButton = (() => {
    if (busy) return null
    if (sel.homogeneousKind === 'held')
      return <LinkBtn label="Release" color={colors.muted} onPress={bulkFree} />
    if (sel.homogeneousKind === 'blocked')
      return <WideBtn label="Unblock" bg="#16a34a" onPress={bulkFree} />
    if (sel.homogeneousKind === 'comp')
      return <WideBtn label="End comp" bg="#16a34a" onPress={bulkFree} />
    if (sel.canCashRelease)
      return (
        <LinkBtn
          label={sel.refundTotal > 0 ? `Refund €${sel.refundTotal.toFixed(2)}` : 'Unreserve'}
          color={colors.danger}
          onPress={() => setConfirm('unreserve')}
        />
      )
    if (sel.homogeneousKind === 'failed') return <WideBtn label="Remove" bg={colors.danger} onPress={bulkFree} />
    return null
  })()

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.sheet}>
        <View style={styles.headerRow}>
          <Text style={styles.headerCount}>{selectedIds.length} selected</Text>
          <View style={{ flexGrow: 1 }} />
          <Pressable onPress={onClearSelection} style={styles.closeBtn}>
            <CloseIcon />
          </Pressable>
        </View>
        <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 330 }} contentContainerStyle={{ gap: 12 }}>
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {busy && <ActivityIndicator color={colors.accent} />}

          {confirm ? (
            <View style={{ gap: 12 }}>
              <View style={styles.confirmCard}>
                <Text style={styles.confirmText}>{confirmCopy}</Text>
              </View>
              <View style={styles.rowGap8}>
                <WideBtn label="Back" bg={colors.chipBg} fg={colors.body} onPress={() => setConfirm(null)} />
                <WideBtn label="Confirm" bg={colors.danger} onPress={runConfirm} />
              </View>
            </View>
          ) : (
            <>
              {sel.canRent && (
                <View style={styles.rowGap8}>
                  <TextInput
                    style={styles.input}
                    placeholder="Guest name"
                    placeholderTextColor={colors.faint}
                    value={guestName}
                    onChangeText={setGuestName}
                    editable={!busy}
                  />
                  <Pressable
                    onPress={() => setUntil(until ? '' : isoDay(1))}
                    style={[styles.calBtn, !!until && styles.calBtnActive]}
                  >
                    {until ? (
                      <Text style={styles.calBtnTextActive}>
                        {Math.max(1, Math.round((new Date(until).getTime() - Date.now()) / DAY_MS))}d
                      </Text>
                    ) : (
                      <CalendarIcon />
                    )}
                  </Pressable>
                </View>
              )}

              {sel.allAvailable && (
                <>
                  <View style={styles.rowGap8}>
                    <Pressable
                      style={styles.square}
                      disabled={busy}
                      onPress={() => void grouped(() => rpc('blockBeds', [siteId, selectedIds, undefined, accessKey, workerId]))}
                    >
                      <BlockIcon />
                      <Text style={styles.squareLabel}>Block</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.square, { borderColor: '#bae6fd', backgroundColor: '#f0f9ff' }]}
                      disabled={busy}
                      onPress={() => void grouped(() => rpc('compBeds', [siteId, selectedIds, accessKey, nameArg, undefined, workerId, untilArg]))}
                    >
                      <StarIcon />
                      <Text style={[styles.squareLabel, { color: '#0369a1' }]}>Comp</Text>
                    </Pressable>
                    <WideBtn
                      label="Reserve" bg="#c026d3" tall disabled={busy}
                      onPress={() => void grouped(() => rpc('holdBeds', [siteId, selectedIds, accessKey, nameArg, undefined, workerId, untilArg]))}
                    />
                  </View>
                  {siteIsPaid ? (
                    <View style={{ gap: 8 }}>
                      <Text style={styles.caption}>Walk-in — how are they paying?</Text>
                      <View style={styles.rowGap8}>
                        <PayBtn label="Cash" bg={colors.danger} icon={<BanknoteIcon />} disabled={busy} onPress={bulkRentCash} />
                        {sel.bulkCardEligible && (
                          <PayBtn label={cardLabel} bg={colors.info} icon={<QrIcon />} disabled={busy} onPress={() => void bulkRentCard()} />
                        )}
                      </View>
                    </View>
                  ) : (
                    <WideBtn label="Walk-in" bg={colors.danger} disabled={busy} onPress={bulkRentCash} />
                  )}
                </>
              )}

              {showHeldRent && (
                <View style={styles.rowGap8}>
                  {siteIsPaid ? (
                    <>
                      <PayBtn label="Cash" bg={colors.danger} icon={<BanknoteIcon />} disabled={busy} onPress={bulkRentCash} />
                      {sel.bulkCardEligible && (
                        <PayBtn label={cardLabel} bg={colors.info} icon={<QrIcon />} disabled={busy} onPress={() => void bulkRentCard()} />
                      )}
                    </>
                  ) : (
                    <WideBtn label="Check in" bg={colors.danger} disabled={busy} onPress={bulkRentCash} />
                  )}
                  {sel.canMove && moveSquare}
                </View>
              )}

              {sel.canCheckIn && (
                <View style={styles.rowGap8}>
                  <WideBtn label="Check in" bg={colors.info} disabled={busy} onPress={bulkCheckIn} />
                  {sel.canMove && moveSquare}
                </View>
              )}

              {sel.canDepart && (
                <View style={styles.rowGap8}>
                  <WideBtn label="Mark departed" bg="#374151" disabled={busy} onPress={() => setConfirm('depart')} />
                  {sel.canMove && moveSquare}
                </View>
              )}

              {sel.canMove && !dominantRow && (
                <Pressable style={styles.moveWide} onPress={startMove} disabled={busy}>
                  <MoveIcon />
                  <Text style={styles.moveWideText}>Move</Text>
                </Pressable>
              )}

              {freeButton}

              <View style={styles.linkRow}>
                {sel.canNoShow && <LinkBtn label="Mark no-show" color={colors.muted} onPress={() => setConfirm('no-show')} />}
                {sel.canCancel && <LinkBtn label="Cancel reservation" color={colors.danger} onPress={() => setConfirm('cancel')} />}
              </View>
              {sel.cancelBlockedByPaid && (
                <Text style={styles.note}>Cancel paid bookings one at a time to handle the refund</Text>
              )}
              {!sel.sameStatus && selectedIds.length > 0 && (
                <Text style={styles.note}>Select seats of the same status to act on them</Text>
              )}
            </>
          )}
        </ScrollView>
      </View>

      {collectTarget && (
        <CollectPaymentModal
          actions={collectActionsFor(siteId, collectTarget, accessKey)}
          terminals={terminals}
          selectedTerminalId={selectedTerminalId}
          onSettled={onChanged}
          onClose={() => {
            setCollectTarget(null)
            onClearSelection()
          }}
        />
      )}
    </View>
  )
}

function collectActionsFor(siteId: string, reservationId: string, accessKey: string): CollectActions {
  return {
    create: (choice: CollectChoice) =>
      rpc('collectReservationPayment', [
        siteId, reservationId, accessKey,
        ...(choice.method === 'card' ? [{ method: 'card', terminalId: choice.terminalId }] : []),
      ]),
    poll: () => rpc('getCollectStatus', [siteId, reservationId, accessKey]),
    cancel: opts =>
      rpc('cancelCollection', [
        siteId, reservationId, accessKey,
        ...(opts?.terminalId ? [{ terminalId: opts.terminalId }] : []),
      ]),
  }
}

function WideBtn({
  label, bg, fg = '#ffffff', onPress, disabled = false, tall = false,
}: {
  label: string
  bg: string
  fg?: string
  onPress: () => void
  disabled?: boolean
  tall?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.wide, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }, tall && { height: 60 }]}
    >
      <Text style={[styles.wideText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

function PayBtn({
  label, bg, icon, onPress, disabled = false,
}: {
  label: string
  bg: string
  icon: React.ReactNode
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.payBtn, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }]}
    >
      {icon}
      <Text style={styles.payBtnLabel}>{label}</Text>
    </Pressable>
  )
}

function LinkBtn({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.link}>
      <Text style={[styles.linkText, { color }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerCount: { fontSize: 24, fontWeight: '900', color: colors.heading },
  closeBtn: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  errorCard: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 12 },
  errorText: { fontSize: 13, color: '#b91c1c' },
  confirmCard: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, padding: 14 },
  confirmText: { fontSize: 14, color: '#92400e', lineHeight: 20 },
  rowGap8: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flexGrow: 1, flexShrink: 1, borderWidth: 1, borderColor: colors.borderInput, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: colors.heading,
    backgroundColor: colors.cardBg,
  },
  calBtn: {
    width: 46, height: 46, borderWidth: 1, borderColor: colors.borderInput, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg,
  },
  calBtnActive: { backgroundColor: '#c026d3', borderColor: '#c026d3' },
  calBtnTextActive: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  caption: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  square: {
    width: 62, height: 60, borderRadius: 10, borderWidth: 1.5, borderColor: '#d1d5db',
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  squareLabel: { fontSize: 10, fontWeight: '600', color: '#4b5563' },
  wide: {
    flexGrow: 1, flexBasis: 0, height: 50, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
  },
  wideText: { fontSize: 15, fontWeight: '600' },
  payBtn: {
    flexGrow: 1, flexBasis: 0, height: 60, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  payBtnLabel: { fontSize: 12, fontWeight: '600', color: '#ffffff' },
  moveWide: {
    height: 50, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderInput,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  moveWideText: { fontSize: 15, fontWeight: '600', color: colors.body },
  link: { paddingVertical: 8, paddingHorizontal: 8, alignItems: 'center' },
  linkText: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  note: { fontSize: 12, color: colors.faint, textAlign: 'center' },
})
