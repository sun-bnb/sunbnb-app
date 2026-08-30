/**
 * Bed-detail bottom sheet — RN port of the web BedDetail
 * (apps/partner/.../BedDetail.tsx), branch for branch. All state derivation
 * comes from @repo/floor-core/bed-state (the single opinion on seat state);
 * every mutation goes through the token-gated RPC. Move mode lands with W4.
 */
import React, { useMemo, useState } from 'react'
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import {
  RESERVATION_COMPLETE, RESERVATION_HELD, RESERVATION_PAID_IN_CASH,
} from '@repo/data/reservation-status'
import { formatSeatId } from '@repo/data/seat-label'
import {
  getActiveReservation, getBedState, isFailedReservationStatus,
  freedSeatShare, settledTotal, type BedState,
} from '@repo/floor-core/bed-state'
import { groupExtraSeatLabel } from '@repo/floor-core/grid-helpers'
import type { InventoryItem, Reservation } from '@repo/floor-core/types'
import CollectPaymentModal, { type CollectActions } from '@/components/CollectPaymentModal'
import { BanknoteIcon, BlockIcon, CalendarIcon, CloseIcon, MoveIcon, QrIcon, StarIcon } from '@/components/icons'
import { rpc, type ActionResult, type CollectChoice, type VivaTerminal } from '@/lib/api'
import { poolSeq } from '@/lib/grid-layout'
import { colors } from '@/theme'

const TOGGLE_VISIBLE_STATES: BedState[] = ['available']
const DAY_MS = 86_400_000

type ConfirmKind = 'no-show' | 'depart' | 'unreserve' | 'remove' | 'cancel'

const BADGE: Record<BedState, { bg: string; fg: string; label: string }> = {
  available: { bg: '#bbf7d0', fg: '#14532d', label: 'Free' },
  expected: { bg: '#f5d0fe', fg: '#701a75', label: 'Reserved' },
  'checked-in': { bg: '#fecaca', fg: '#7f1d1d', label: 'Occupied' },
  'walked-in': { bg: '#fecaca', fg: '#7f1d1d', label: 'Occupied' },
  blocked: { bg: '#d1d5db', fg: '#1f2937', label: 'Blocked' },
  comp: { bg: '#bae6fd', fg: '#0c4a6e', label: 'Comp' },
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)
}
function fmtTime(d: unknown): string | null {
  if (!d) return null
  const date = new Date(d as string)
  if (isNaN(date.getTime())) return null
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
function daysPastToday(to: unknown): number {
  const t = new Date(to as string).getTime()
  if (isNaN(t)) return 0
  return Math.max(0, Math.round((t - Date.now()) / DAY_MS))
}

export default function BedDetailSheet({
  siteId, accessKey, item, groupItems, reservationItemIds, isPool, isGroupExtra,
  siteIsPaid, currentWorkerId, onClose, onChanged, onMove, terminals = [], selectedTerminalId = null,
}: {
  siteId: string
  accessKey: string
  item: InventoryItem
  groupItems: InventoryItem[]
  reservationItemIds: string[]
  isPool: boolean
  isGroupExtra: boolean
  siteIsPaid: boolean
  currentWorkerId?: string
  onClose: () => void
  onChanged: () => void
  /** Enter move mode for this reservation (closes the sheet). */
  onMove?: (reservationId: string) => void
  /** Site Viva terminals — non-empty enables Tap card in the collect modal ([[track:024]] W8). */
  terminals?: VivaTerminal[]
  selectedTerminalId?: string | null
}) {
  const cardLabel = terminals.length > 0 ? 'Card' : 'Card (QR)'
  const state = getBedState(item)
  const reservation = getActiveReservation(item)
  const collected = !!reservation && reservation.status === RESERVATION_COMPLETE
  const settled = (reservation?.tillEntries?.length ?? 0) > 0
  const thisResId = reservation?.id ?? null
  const inSync = groupItems.length > 0
    ? groupItems.every(gi => (getActiveReservation(gi)?.id ?? null) === thisResId)
    : true
  const pairItem = groupItems.length === 1 ? groupItems[0]! : null
  const pairNumber =
    isPool || isGroupExtra || !inSync ? undefined : pairItem ? formatSeatId(pairItem, { parcel: true }) : undefined
  const groupedReservation = reservationItemIds.length > 1
  const isMolliePaid = !!reservation?.paymentRef?.startsWith('tr_')

  const [applyToPair, setApplyToPair] = useState(inSync)
  const [applyToGroup, setApplyToGroup] = useState(true)
  const [guestName, setGuestName] = useState('')
  const [until, setUntil] = useState('')
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const busy = pendingKey !== null
  const [error, setError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmKind | null>(null)
  const [showSettle, setShowSettle] = useState(false)
  const [settleAmount, setSettleAmount] = useState(String(reservation?.paymentAmount ?? ''))
  const [collectTarget, setCollectTarget] = useState<string | null>(null)
  const [refunded, setRefunded] = useState(!!reservation?.refundedAt)

  const header = isPool && !isGroupExtra
    ? `+${poolSeq(item)}`
    : isGroupExtra
      ? `#${groupExtraSeatLabel(item, groupItems)}`
      : `#${formatSeatId(item, { parcel: true })}`
  const subCaption = isGroupExtra
    ? 'extra seat'
    : isPool
      ? 'additional seat'
      : null
  const badge = BADGE[state]
  const untilArg = isPool ? undefined : until || undefined
  const pairArg = groupItems.length > 0 ? applyToPair : false
  const worker = currentWorkerId

  async function run(key: string, fn: () => Promise<ActionResult>, opts?: { keepOpen?: boolean }) {
    if (busy) return null
    setPendingKey(key)
    setError(null)
    try {
      const res = await fn()
      if (res.status === 'ok') {
        onChanged()
        if (!opts?.keepOpen) onClose()
        return res
      }
      setError(res.errors?.[0] ?? 'Something went wrong')
      return null
    } catch {
      setError('Could not reach the server.')
      return null
    } finally {
      setPendingKey(null)
    }
  }

  /** Card (QR) walk-in: create unsettled, then collect against the new reservation. */
  async function walkInCard(key: string, create: () => Promise<ActionResult & { reservationId?: string }>) {
    if (busy) return
    setPendingKey(key)
    setError(null)
    try {
      const res = await create()
      if (res.status === 'ok' && typeof res.reservationId === 'string') {
        setCollectTarget(res.reservationId)
        onChanged()
      } else if (res.status === 'ok') {
        setError('Could not start collection')
      } else {
        setError(res.errors?.[0] ?? 'Something went wrong')
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPendingKey(null)
    }
  }

  /** Collect on an occupied walk-in — Seat scope on a multi-seat party splits first. */
  async function collectWalkIn() {
    if (!reservation || busy) return
    if (!applyToGroup && groupedReservation) {
      setPendingKey('collect')
      setError(null)
      try {
        const res = await rpc<ActionResult & { reservationId?: string }>('splitWalkInSeat', [
          siteId, reservation.id, item.id, accessKey,
        ])
        if (res.status === 'ok' && typeof res.reservationId === 'string') {
          setCollectTarget(res.reservationId)
          onChanged()
        } else {
          setError(res.errors?.[0] ?? 'Could not split seat for collection')
        }
      } catch {
        setError('Could not reach the server.')
      } finally {
        setPendingKey(null)
      }
      return
    }
    setCollectTarget(reservation.id)
  }

  function runPendingConfirm() {
    if (!pendingConfirm || !reservation) return
    const kind = pendingConfirm
    if (kind === 'no-show') void run('confirm', () => rpc('markNoShow', [siteId, reservation.id, accessKey]))
    else if (kind === 'cancel') void run('confirm', () => rpc('cancelReservation', [siteId, item.id, accessKey]))
    else if (kind === 'remove') void run('confirm', () => rpc('removeFailedReservation', [siteId, reservation.id, accessKey]))
    else if (kind === 'depart') {
      const splitDepart = state === 'walked-in' && !collected && !applyToGroup && groupedReservation
      void run('confirm', () =>
        rpc('markDeparted', splitDepart
          ? [siteId, reservation.id, accessKey, [item.id]]
          : [siteId, reservation.id, accessKey]),
      )
    } else if (kind === 'unreserve') {
      void run('confirm', () =>
        rpc('unreserveItem', [
          siteId, item.id, accessKey,
          state === 'walked-in' ? applyToGroup : applyToPair,
          true, worker,
        ]),
      )
    }
  }

  const confirmCopy = useMemo(() => {
    if (!pendingConfirm) return ''
    if (pendingConfirm === 'no-show')
      return 'Marking as a no-show — the guest never arrived. The payment is kept; the seat frees up.'
    if (pendingConfirm === 'depart')
      return 'Marking as departed. The payment is kept; the seat frees up.'
    if (pendingConfirm === 'remove')
      return 'Removing this reservation — the payment was never taken. The seat frees up immediately.'
    if (pendingConfirm === 'cancel')
      return 'Cancelling this reservation frees the seat. Issue a refund below if the guest paid online.'
    // unreserve
    if (reservation && settled) {
      const amount =
        state === 'walked-in' && !applyToGroup && groupedReservation
          ? freedSeatShare(reservation, item.id)
          : settledTotal(reservation)
      return `Ending this walk-in refunds €${amount.toFixed(2)} — removed from the till; hand the cash back. The seat frees up.`
    }
    return 'Ending this walk-in — the seat frees up.'
  }, [pendingConfirm, reservation, settled, state, applyToGroup, groupedReservation, item.id])

  const showScopeToggle =
    groupItems.length > 0 && TOGGLE_VISIBLE_STATES.includes(state) && !pendingConfirm

  const failedRes = state === 'expected' && reservation && isFailedReservationStatus(reservation.status)

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
            {/* Header */}
            <View style={styles.headerRow}>
              <Text style={styles.headerId}>{header}</Text>
              {pairNumber && (
                <View style={styles.pairChip}>
                  <Text style={styles.pairChipText}>+ #{pairNumber}</Text>
                </View>
              )}
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
              </View>
              <View style={{ flexGrow: 1 }} />
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <CloseIcon />
              </Pressable>
            </View>
            {subCaption && <Text style={styles.subCaption}>{subCaption}</Text>}

            {error && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Group-scope toggle (physical pair/group) */}
            {showScopeToggle &&
              (inSync ? (
                <Segmented
                  left={groupItems.length >= 2 ? 'Group' : 'Pair'}
                  right="Seat"
                  value={applyToPair}
                  onChange={setApplyToPair}
                />
              ) : (
                <View style={styles.seatLockChip}>
                  <Text style={styles.seatLockText}>Seat</Text>
                </View>
              ))}

            {/* Confirm panel replaces branch actions */}
            {pendingConfirm ? (
              <View style={{ gap: 12 }}>
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmText}>{confirmCopy}</Text>
                </View>
                {pendingConfirm === 'cancel' && isMolliePaid && (
                  <View style={styles.refundRow}>
                    {refunded ? (
                      <Text style={styles.refundedText}>✓ Refunded</Text>
                    ) : (
                      <WideBtn
                        label="Issue refund"
                        bg={colors.info}
                        pending={pendingKey === 'refund'}
                        disabled={busy}
                        onPress={() =>
                          void run('refund', () => rpc('refundReservation', [siteId, item.id, accessKey]), {
                            keepOpen: true,
                          }).then(res => {
                            if (res) setRefunded(true)
                          })
                        }
                      />
                    )}
                  </View>
                )}
                <View style={styles.rowGap8}>
                  <WideBtn label="Back" bg={colors.chipBg} fg={colors.body} onPress={() => setPendingConfirm(null)} />
                  <WideBtn label="Confirm" bg={colors.danger} pending={pendingKey === 'confirm'} disabled={busy} onPress={runPendingConfirm} />
                </View>
              </View>
            ) : (
              <>
                {/* ── available ── */}
                {state === 'available' && (
                  <View style={{ gap: 12 }}>
                    <View style={styles.rowGap8}>
                      <TextInput
                        style={styles.input}
                        placeholder="Guest name"
                        placeholderTextColor={colors.faint}
                        value={guestName}
                        onChangeText={setGuestName}
                      />
                      {!isPool && (
                        <Pressable
                          onPress={() => setUntil(until ? '' : isoDay(1))}
                          style={[styles.calBtn, !!until && styles.calBtnActive]}
                        >
                          {until ? (
                            <Text style={[styles.calBtnText, { color: '#ffffff' }]}>
                              {`${Math.max(1, Math.round((new Date(until).getTime() - Date.now()) / DAY_MS))}d`}
                            </Text>
                          ) : (
                            <CalendarIcon />
                          )}
                        </Pressable>
                      )}
                    </View>
                    {until !== '' && (
                      <DateStepper value={until} onChange={setUntil} onClear={() => setUntil('')} />
                    )}
                    <View style={styles.rowGap8}>
                      <SquareBtn
                        label="Block" icon={<BlockIcon />} border="#d1d5db" bg="#ffffff" fg="#4b5563"
                        onPress={() => void run('block', () => rpc('blockBed', [siteId, item.id, undefined, accessKey, pairArg, worker]))}
                      />
                      <SquareBtn
                        label="Comp" icon={<StarIcon />} border="#bae6fd" bg="#f0f9ff" fg="#0369a1"
                        onPress={() =>
                          void run('comp', () => rpc('compBed', [siteId, item.id, accessKey, pairArg, guestName || undefined, undefined, worker, untilArg]))
                        }
                      />
                      <WideBtn
                        label="Reserve" bg="#c026d3" tall pending={pendingKey === 'reserve'} disabled={busy}
                        onPress={() =>
                          void run('reserve', () => rpc('holdBed', [siteId, item.id, accessKey, pairArg, guestName || undefined, undefined, worker, untilArg]))
                        }
                      />
                    </View>
                    {!siteIsPaid ? (
                      <WideBtn
                        label="Walk-in" bg={colors.danger} pending={pendingKey === 'walkin'} disabled={busy}
                        onPress={() =>
                          void run('walkin', () => rpc('reserveItem', [siteId, item.id, guestName || undefined, undefined, accessKey, untilArg, pairArg, worker]))
                        }
                      />
                    ) : (
                      <View style={{ gap: 8 }}>
                        <Text style={styles.caption}>Walk-in — how are they paying?</Text>
                        <View style={styles.rowGap8}>
                          <PayBtn
                            label="Cash" bg={colors.danger} icon={<BanknoteIcon />} pending={pendingKey === 'cash'} disabled={busy}
                            onPress={() =>
                              void run('cash', () => rpc('reserveItem', [siteId, item.id, guestName || undefined, undefined, accessKey, untilArg, pairArg, worker, true]))
                            }
                          />
                          <PayBtn
                            label={cardLabel} bg={colors.info} icon={<QrIcon />} pending={pendingKey === 'card'} disabled={busy}
                            onPress={() =>
                              void walkInCard('card', () =>
                                rpc('reserveItem', [siteId, item.id, guestName || undefined, undefined, accessKey, untilArg, pairArg, worker, false]),
                              )
                            }
                          />
                        </View>
                      </View>
                    )}
                    {(groupItems.length > 0 || (isPool && !isGroupExtra)) && (
                      <View style={styles.footerLinks}>
                        {groupItems.length > 0 && (
                          <LinkBtn label="Add extra seat" color={colors.muted}
                            onPress={() => void run('add-seat', () => rpc('addSeatToGroup', [siteId, item.id, accessKey]))} />
                        )}
                        {isGroupExtra && (
                          <LinkBtn label="Remove extra seat" color={colors.danger}
                            onPress={() => void run('rm-extra', () => rpc('removeGroupSeat', [siteId, item.id, accessKey]))} />
                        )}
                        {isPool && !isGroupExtra && (
                          <LinkBtn label="Remove seat" color={colors.danger}
                            onPress={() => void run('rm-pool', () => rpc('deletePoolSeat', [siteId, item.id, accessKey]))} />
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* ── expected: failed payment ── */}
                {failedRes && reservation && (
                  <View style={{ gap: 12 }}>
                    <View style={[styles.occCard, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
                      <View style={{ flexGrow: 1 }}>
                        <Text style={styles.occName}>{reservation.guestName || reservation.user?.email || 'Guest'}</Text>
                        {!!reservation.user?.email && <Text style={styles.occSub}>{reservation.user.email}</Text>}
                      </View>
                      <View style={styles.failChip}><Text style={styles.failChipText}>Payment failed</Text></View>
                    </View>
                    <WideBtn label="Remove" bg={colors.danger} disabled={busy} onPress={() => setPendingConfirm('remove')} />
                  </View>
                )}

                {/* ── expected: online-paid / cash multiday / held / in-flight ── */}
                {state === 'expected' && reservation && !failedRes && (
                  <ExpectedBranch
                    reservation={reservation}
                    groupedReservation={groupedReservation}
                    applyToGroup={applyToGroup}
                    setApplyToGroup={setApplyToGroup}
                    siteIsPaid={siteIsPaid}
                    guestName={guestName}
                    setGuestName={setGuestName}
                    until={until}
                    setUntil={setUntil}
                    pendingKey={pendingKey}
                    settled={settled}
                    onCheckIn={() => void run('checkin', () => rpc('checkInReservation', [siteId, reservation.id, accessKey]))}
                    onResume={() => void run('checkin', () => rpc('resumeWalkIn', [siteId, reservation.id, accessKey]))}
                    onNoShow={() => setPendingConfirm('no-show')}
                    onCancel={() => setPendingConfirm('cancel')}
                    onUnreserve={() => setPendingConfirm('unreserve')}
                    onRelease={() => void run('release', () => rpc('releaseHold', [siteId, item.id, accessKey]))}
                    onMove={onMove && reservation ? () => { onClose(); onMove(reservation.id) } : undefined}
                    cardLabel={cardLabel}
                    onConvert={(cash: boolean) => {
                      const args = [
                        siteId, item.id, accessKey, guestName || reservation.guestName || undefined,
                        until || undefined, worker, applyToGroup, undefined, cash,
                      ]
                      if (cash) void run('cash', () => rpc('convertHoldToWalkIn', args))
                      else void walkInCard('card', () => rpc('convertHoldToWalkIn', args))
                    }}
                  />
                )}

                {/* ── checked-in ── */}
                {state === 'checked-in' && reservation && (
                  <View style={{ gap: 12 }}>
                    <OccupantInfo reservation={reservation} tint="red" paid />
                    <View style={styles.rowGap8}>
                      <WideBtn label="Mark departed" bg="#374151" disabled={busy} onPress={() => setPendingConfirm('depart')} />
                      {onMove && reservation && <MoveSquare onPress={() => { onClose(); onMove(reservation.id) }} />}
                    </View>
                    <LinkBtn label="Cancel reservation" color={colors.danger} center onPress={() => setPendingConfirm('cancel')} />
                  </View>
                )}

                {/* ── walked-in ── */}
                {state === 'walked-in' && reservation && (
                  <View style={{ gap: 12 }}>
                    {groupedReservation && !collected && (
                      <Segmented left="Group" right="Seat" value={applyToGroup} onChange={setApplyToGroup} />
                    )}
                    <OccupantInfo reservation={reservation} tint="red" paid={collected || settled} fallbackName="Walk-in" />
                    {siteIsPaid && !collected && !settled && (
                      <>
                        {showSettle ? (
                          <View style={styles.settleCard}>
                            <Text style={styles.settleCaption}>Cash received</Text>
                            <TextInput
                              style={styles.input}
                              keyboardType="decimal-pad"
                              value={settleAmount}
                              onChangeText={setSettleAmount}
                            />
                            <View style={styles.rowGap8}>
                              <WideBtn label="Cancel" bg={colors.chipBg} fg={colors.body} onPress={() => setShowSettle(false)} />
                              <WideBtn
                                label="Settle" bg="#16a34a" pending={pendingKey === 'settle'} disabled={busy}
                                onPress={() => {
                                  const amount = parseFloat(settleAmount)
                                  if (!isFinite(amount) || amount <= 0) {
                                    setError('Enter a valid amount')
                                    return
                                  }
                                  void run('settle', () => rpc('settleReservation', [siteId, reservation.id, amount, accessKey, worker]))
                                }}
                              />
                            </View>
                          </View>
                        ) : (
                          <View style={styles.rowGap8}>
                            <SquareBtn label="Settle" icon={<BanknoteIcon color="#16a34a" />} border="#bbf7d0" bg="#f0fdf4" fg="#15803d" onPress={() => setShowSettle(true)} />
                            <WideBtn label="Collect payment" bg={colors.info} pending={pendingKey === 'collect'} disabled={busy} onPress={() => void collectWalkIn()} />
                          </View>
                        )}
                      </>
                    )}
                    <View style={styles.rowGap8}>
                      <WideBtn label="Mark departed" bg="#374151" disabled={busy} onPress={() => setPendingConfirm('depart')} />
                      {onMove && reservation && <MoveSquare onPress={() => { onClose(); onMove(reservation.id) }} />}
                    </View>
                    <LinkBtn
                      center
                      label={collected ? 'Cancel reservation' : settled ? 'Refund' : 'Unreserve'}
                      color={colors.danger}
                      onPress={() => setPendingConfirm(collected ? 'cancel' : 'unreserve')}
                    />
                  </View>
                )}

                {/* ── blocked ── */}
                {state === 'blocked' && (
                  <View style={{ gap: 12 }}>
                    {reservation && groupedReservation && (
                      <Segmented left="Group" right="Seat" value={applyToGroup} onChange={setApplyToGroup} />
                    )}
                    <View style={[styles.occCard, { backgroundColor: '#f3f4f6', borderColor: '#d1d5db' }]}>
                      <Text style={[styles.occName, !reservation?.internalNotes && styles.italicMuted]}>
                        {reservation?.internalNotes || 'Blocked'}
                      </Text>
                      <Text style={styles.blockGlyph}>✕</Text>
                    </View>
                    <WideBtn label="Unblock" bg="#16a34a" pending={pendingKey === 'unblock'} disabled={busy}
                      onPress={() => void run('unblock', () => rpc('unblockBed', [siteId, item.id, accessKey, groupedReservation ? applyToGroup : false]))} />
                  </View>
                )}

                {/* ── comp ── */}
                {state === 'comp' && (
                  <View style={{ gap: 12 }}>
                    {reservation && groupedReservation && (
                      <Segmented left="Group" right="Seat" value={applyToGroup} onChange={setApplyToGroup} />
                    )}
                    <View style={[styles.occCard, { backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }]}>
                      <View style={{ flexGrow: 1 }}>
                        <Text style={[styles.occName, !reservation?.guestName && styles.italicMuted]}>
                          {reservation?.guestName || 'Comp'}
                        </Text>
                        {!!reservation?.internalNotes && <Text style={styles.occSub}>{reservation.internalNotes}</Text>}
                      </View>
                      <Text style={[styles.blockGlyph, { color: '#0284c7' }]}>★</Text>
                    </View>
                    <WideBtn label="End comp" bg="#16a34a" pending={pendingKey === 'uncomp'} disabled={busy}
                      onPress={() => void run('uncomp', () => rpc('uncompBed', [siteId, item.id, accessKey, groupedReservation ? applyToGroup : false]))} />
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>

      {collectTarget && (
        <CollectPaymentModal
          subtitle={header}
          actions={collectActionsFor(siteId, collectTarget, accessKey)}
          terminals={terminals}
          selectedTerminalId={selectedTerminalId}
          onSettled={onChanged}
          onClose={() => {
            setCollectTarget(null)
            onClose()
          }}
        />
      )}
    </Modal>
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

/* ── The expected-state sub-branches (COMPLETE / PAID_IN_CASH / HELD / in-flight) ── */
function ExpectedBranch(props: {
  reservation: Reservation
  groupedReservation: boolean
  applyToGroup: boolean
  setApplyToGroup: (v: boolean) => void
  siteIsPaid: boolean
  guestName: string
  setGuestName: (v: string) => void
  until: string
  setUntil: (v: string) => void
  pendingKey: string | null
  settled: boolean
  onCheckIn: () => void
  onResume: () => void
  onNoShow: () => void
  onCancel: () => void
  onUnreserve: () => void
  onRelease: () => void
  onMove?: () => void
  onConvert: (cash: boolean) => void
  cardLabel: string
}) {
  const r = props.reservation
  if (r.status === RESERVATION_COMPLETE) {
    return (
      <View style={{ gap: 12 }}>
        <OccupantInfo reservation={r} tint="fuchsia" paid />
        <View style={styles.rowGap8}>
          <WideBtn label="Check in" bg={colors.info} pending={props.pendingKey === 'checkin'} disabled={props.pendingKey !== null} onPress={props.onCheckIn} />
          {props.onMove && <MoveSquare onPress={props.onMove} />}
        </View>
        <View style={styles.linkRow}>
          <LinkBtn label="Mark no-show" color={colors.muted} onPress={props.onNoShow} />
          <LinkBtn label="Cancel reservation" color={colors.danger} onPress={props.onCancel} />
        </View>
      </View>
    )
  }
  if (r.status === RESERVATION_PAID_IN_CASH) {
    return (
      <View style={{ gap: 12 }}>
        <OccupantInfo reservation={r} tint="fuchsia" paid fallbackName="Walk-in" />
        <View style={styles.rowGap8}>
          <WideBtn label="Check in" bg={colors.danger} pending={props.pendingKey === 'checkin'} disabled={props.pendingKey !== null} onPress={props.onResume} />
          {props.onMove && <MoveSquare onPress={props.onMove} />}
        </View>
        <LinkBtn center label={props.settled ? 'Refund' : 'Unreserve'} color={colors.danger} onPress={props.onUnreserve} />
      </View>
    )
  }
  if (r.status === RESERVATION_HELD) {
    return (
      <View style={{ gap: 12 }}>
        {props.groupedReservation && (
          <Segmented left="Group" right="Seat" value={props.applyToGroup} onChange={props.setApplyToGroup} />
        )}
        {r.guestName ? (
          <View style={[styles.occCard, styles.holdCard]}>
            <View style={{ flexGrow: 1 }}>
              <Text style={styles.occName}>{r.guestName}</Text>
              {!!r.internalNotes && <Text style={styles.occSub}>{r.internalNotes}</Text>}
            </View>
          </View>
        ) : (
          <TextInput
            style={styles.input}
            placeholder="Guest name"
            placeholderTextColor={colors.faint}
            value={props.guestName}
            onChangeText={props.setGuestName}
          />
        )}
        {props.siteIsPaid ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.caption}>Walk-in — how are they paying?</Text>
            <View style={styles.rowGap8}>
              <PayBtn label="Cash" bg={colors.danger} icon={<BanknoteIcon />} pending={props.pendingKey === 'cash'} disabled={props.pendingKey !== null} onPress={() => props.onConvert(true)} />
              <PayBtn label={props.cardLabel} bg={colors.info} icon={<QrIcon />} pending={props.pendingKey === 'card'} disabled={props.pendingKey !== null} onPress={() => props.onConvert(false)} />
            </View>
          </View>
        ) : (
          <WideBtn label="Check in" bg={colors.danger} pending={props.pendingKey === 'cash'} disabled={props.pendingKey !== null} onPress={() => props.onConvert(true)} />
        )}
        <LinkBtn center label="Release" color={colors.muted} onPress={props.onRelease} />
      </View>
    )
  }
  // In-flight / unknown (processing, pending): read-only
  return (
    <View style={[styles.occCard, styles.holdCard]}>
      <View style={{ flexGrow: 1 }}>
        <Text style={styles.occName}>{r.guestName || r.user?.email || 'Guest'}</Text>
        {!!r.user?.email && <Text style={styles.occSub}>{r.user.email}</Text>}
      </View>
      <View style={styles.failChip}>
        <Text style={styles.failChipText}>{r.status}</Text>
      </View>
    </View>
  )
}

function MoveSquare({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.moveSquare}>
      <MoveIcon />
      <Text style={styles.moveSquareLabel}>Move</Text>
    </Pressable>
  )
}

/* ── Shared bits ── */

function OccupantInfo({
  reservation, tint, paid = false, fallbackName = 'Guest',
}: {
  reservation: Reservation
  tint: 'red' | 'fuchsia'
  paid?: boolean
  fallbackName?: string
}) {
  const bg = tint === 'red' ? '#fef2f2' : '#fdf4ff'
  const border = tint === 'red' ? '#fecaca' : '#f5d0fe'
  const time = fmtTime(reservation.today?.checkedInAt ?? reservation.checkedInAt)
  const days = daysPastToday(reservation.to)
  return (
    <View style={[styles.occCard, { backgroundColor: bg, borderColor: border }]}>
      <Text
        style={[styles.occName, { flexShrink: 1 }, !reservation.guestName && styles.italicMuted]}
        numberOfLines={1}
      >
        {reservation.guestName || fallbackName}
      </Text>
      <View style={styles.occRight}>
        {!!reservation.internalNotes && <Text style={styles.noteGlyph}>✎</Text>}
        {paid && <Text style={styles.paidGlyph}>€✓</Text>}
        {time && (
          <View style={styles.timePill}>
            <Text style={styles.timePillText}>{time}</Text>
          </View>
        )}
        {days > 0 && (
          <View style={styles.daysChip}>
            <Text style={styles.daysChipText}>{days}D</Text>
          </View>
        )}
      </View>
    </View>
  )
}

function Segmented({
  left, right, value, onChange,
}: {
  left: string
  right: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <View style={styles.segmented}>
      <Pressable onPress={() => onChange(true)} style={[styles.segment, value && styles.segmentActive]}>
        <Text style={[styles.segmentText, value && styles.segmentTextActive]}>{left}</Text>
      </Pressable>
      <Pressable onPress={() => onChange(false)} style={[styles.segment, !value && styles.segmentActive]}>
        <Text style={[styles.segmentText, !value && styles.segmentTextActive]}>{right}</Text>
      </Pressable>
    </View>
  )
}

function DateStepper({ value, onChange, onClear }: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  const min = isoDay(1)
  const max = isoDay(90)
  const step = (days: number) => {
    const next = new Date(new Date(value).getTime() + days * DAY_MS).toISOString().slice(0, 10)
    if (next >= min && next <= max) onChange(next)
  }
  const d = new Date(`${value}T12:00:00.000Z`)
  const label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <View style={styles.dateRow}>
      <Text style={styles.dateLabel}>Until</Text>
      <Pressable onPress={() => step(-1)} style={styles.stepBtn}><Text style={styles.stepBtnText}>−</Text></Pressable>
      <Text style={styles.dateValue}>{label}</Text>
      <Pressable onPress={() => step(1)} style={styles.stepBtn}><Text style={styles.stepBtnText}>+</Text></Pressable>
      <Pressable onPress={onClear} style={styles.stepBtn}><Text style={styles.stepBtnText}>✕</Text></Pressable>
    </View>
  )
}

function SquareBtn({
  label, icon, border, bg, fg, onPress,
}: {
  label: string
  icon: React.ReactNode
  border: string
  bg: string
  fg: string
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={[styles.square, { borderColor: border, backgroundColor: bg }]}>
      {icon}
      <Text style={[styles.squareLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

/** Icon-over-label payment button (mockup vocabulary: Cash / Card / Tap). */
function PayBtn({
  label, bg, icon, onPress, pending = false, disabled = false,
}: {
  label: string
  bg: string
  icon: React.ReactNode
  onPress: () => void
  pending?: boolean
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      style={({ pressed }) => [styles.payBtn, { backgroundColor: bg, opacity: pressed || pending ? 0.85 : 1 }]}
    >
      {pending ? <ActivityIndicator color="#ffffff" /> : icon}
      {!pending && <Text style={styles.payBtnLabel}>{label}</Text>}
    </Pressable>
  )
}

function WideBtn({
  label, bg, fg = '#ffffff', onPress, pending = false, tall = false, disabled = false,
}: {
  label: string
  bg: string
  fg?: string
  onPress: () => void
  pending?: boolean
  tall?: boolean
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || pending}
      style={({ pressed }) => [
        styles.wide,
        { backgroundColor: bg, opacity: pressed || pending ? 0.85 : 1 },
        tall && { height: 60 },
      ]}
    >
      {pending ? <ActivityIndicator color={fg} /> : <Text style={[styles.wideText, { color: fg }]}>{label}</Text>}
    </Pressable>
  )
}

function LinkBtn({
  label, color, onPress, center = false,
}: {
  label: string
  color: string
  onPress: () => void
  center?: boolean
}) {
  return (
    <Pressable onPress={onPress} style={[styles.link, center && { alignSelf: 'center' }]}>
      <Text style={[styles.linkText, { color }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '88%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 999, backgroundColor: colors.borderInput,
    alignSelf: 'center', marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerId: { fontSize: 28, fontWeight: '900', color: colors.heading, letterSpacing: -0.5, lineHeight: 32 },
  subCaption: { fontSize: 12, color: colors.faint, marginTop: -10 },
  pairChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border,
  },
  pairChipText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 15, color: colors.muted },
  errorCard: {
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca',
    borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: '#b91c1c' },
  segmented: {
    flexDirection: 'row', alignSelf: 'stretch', borderWidth: 1, borderColor: colors.borderInput,
    borderRadius: 8, padding: 2, gap: 2, backgroundColor: colors.cardBg,
  },
  segment: {
    flexGrow: 1, flexBasis: 0, paddingVertical: 7, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  segmentTextActive: { color: '#ffffff', fontWeight: '600' },
  seatLockChip: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
    backgroundColor: colors.chipBg,
  },
  seatLockText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  rowGap8: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  payBtn: {
    flexGrow: 1, flexBasis: 0, height: 60, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  payBtnLabel: { fontSize: 12, fontWeight: '600', color: '#ffffff' },
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
  calBtnText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateLabel: { fontSize: 13, color: colors.muted, width: 36 },
  dateValue: { fontSize: 15, fontWeight: '600', color: colors.heading, minWidth: 110, textAlign: 'center' },
  stepBtn: {
    width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: colors.borderInput,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { fontSize: 16, color: colors.body },
  caption: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  moveSquare: {
    width: 62, height: 50, borderRadius: 10, borderWidth: 1.5, borderColor: '#d1d5db',
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  moveSquareLabel: { fontSize: 10, fontWeight: '600', color: '#4b5563' },
  square: {
    width: 62, height: 60, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  squareLabel: { fontSize: 10, fontWeight: '600' },
  wide: {
    flexGrow: 1, flexBasis: 0, height: 50, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
  },
  wideText: { fontSize: 15, fontWeight: '600' },
  link: { paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  footerLinks: {
    flexDirection: 'row', justifyContent: 'center', gap: 24, borderTopWidth: 1,
    borderTopColor: colors.chipBg, paddingTop: 6,
  },
  occCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1,
    borderRadius: 12, padding: 13,
  },
  holdCard: { backgroundColor: '#fdf4ff', borderColor: '#f5d0fe', borderStyle: 'dashed' },
  occName: { fontSize: 15, fontWeight: '600', color: colors.heading },
  occSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  italicMuted: { fontStyle: 'italic', fontWeight: '400', color: colors.muted },
  occRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  noteGlyph: { fontSize: 14, color: colors.muted },
  paidGlyph: { fontSize: 12, fontWeight: '700', color: '#16a34a' },
  timePill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: '#fecaca',
  },
  timePillText: { fontSize: 11, color: colors.body, fontVariant: ['tabular-nums'] },
  daysChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: '#fdf4ff', borderWidth: 1, borderColor: '#f5d0fe',
  },
  daysChipText: { fontSize: 11, fontWeight: '600', color: '#a21caf' },
  failChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fee2e2',
  },
  failChipText: { fontSize: 11, fontWeight: '600', color: '#b91c1c' },
  blockGlyph: { fontSize: 16, fontWeight: '700', color: '#4b5563', marginLeft: 'auto' },
  settleCard: {
    gap: 8, borderWidth: 1, borderColor: '#bbf7d0', backgroundColor: '#f0fdf4',
    borderRadius: 12, padding: 12,
  },
  settleCaption: { fontSize: 12, color: '#15803d', fontWeight: '600' },
  confirmCard: {
    backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
    borderRadius: 12, padding: 14,
  },
  confirmText: { fontSize: 14, color: '#92400e', lineHeight: 20 },
  refundRow: { alignItems: 'stretch' },
  refundedText: { fontSize: 14, fontWeight: '600', color: '#15803d', textAlign: 'center' },
})
