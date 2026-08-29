/**
 * Walk-in rental ("Rent Out") — RN port of the web CreateRentalModal. Design
 * intent preserved: the happy path is two taps (tap a board → tap GO).
 * The Card path must NOT record a till entry — the collect is the payment.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import type { RentalBookingProps, RentalItemProps } from '@repo/floor-core/types'
import CollectPaymentModal, { type CollectActions } from '@/components/CollectPaymentModal'
import { CloseIcon } from '@/components/icons'
import { rpc, type ActionResult } from '@/lib/api'
import { colors } from '@/theme'

type PaymentType = 'cash' | 'card' | 'free'

export default function CreateRentalModal({
  siteId, accessKey, rentalItems, activeBookings, workerId, onClose, onCreated,
}: {
  siteId: string
  accessKey: string
  rentalItems: RentalItemProps[]
  activeBookings: RentalBookingProps[]
  workerId?: string
  onClose: () => void
  onCreated: () => void
}) {
  const rentedOut = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of activeBookings) m.set(b.rentalItemId, (m.get(b.rentalItemId) ?? 0) + b.quantity)
    return m
  }, [activeBookings])

  const stockFor = (item: RentalItemProps) => item.totalQuantity - (rentedOut.get(item.id) ?? 0)

  const [cart, setCart] = useState<Record<string, number>>(() => {
    const stocked = rentalItems.filter(i => stockFor(i) > 0)
    return rentalItems.length === 1 && stocked.length === 1 ? { [stocked[0]!.id]: 1 } : {}
  })
  const [durationType, setDurationType] = useState<'hours' | 'days'>('hours')
  const [hours, setHours] = useState(1)
  const [guestName, setGuestName] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('cash')
  const [moreOpen, setMoreOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardBookingIds, setCardBookingIds] = useState<string[] | null>(null)

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0)
  const totalPrice = useMemo(() => {
    if (paymentType === 'free') return 0
    let sum = 0
    for (const [id, qty] of Object.entries(cart)) {
      const item = rentalItems.find(i => i.id === id)
      if (!item || qty <= 0) continue
      if (durationType === 'hours' && item.pricePerHour) sum += item.pricePerHour * hours * qty
      else if (item.pricePerDay) sum += item.pricePerDay * qty
      else if (item.pricePerHour) sum += item.pricePerHour * hours * qty
    }
    return sum
  }, [cart, rentalItems, durationType, hours, paymentType])

  const adjust = (item: RentalItemProps, delta: number) => {
    setCart(c => {
      const next = Math.max(0, Math.min(stockFor(item), (c[item.id] ?? 0) + delta))
      const copy = { ...c }
      if (next === 0) delete copy[item.id]
      else copy[item.id] = next
      return copy
    })
  }

  async function submit() {
    if (totalItems === 0) {
      setError('Select an item first')
      return
    }
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await rpc<ActionResult & { bookingIds?: string[] }>('createWalkInRental', [
        {
          siteId,
          items: Object.entries(cart).map(([rentalItemId, quantity]) => ({ rentalItemId, quantity })),
          durationType,
          ...(durationType === 'hours' ? { hours } : {}),
          guestName: guestName.trim() || undefined,
          // The wire type only accepts cash|free — the UI's "card" rides as cash
          // WITHOUT a till entry; the Mollie collect is the payment.
          paymentType: paymentType === 'free' ? 'free' : 'cash',
          recordCashSettlement: paymentType === 'cash',
          accessKey,
          employeeId: workerId,
        },
      ])
      if (res.status === 'ok') {
        if (paymentType === 'card' && res.bookingIds?.length) {
          setCardBookingIds(res.bookingIds)
        } else {
          onCreated()
        }
      } else {
        setError(res.errors?.[0] ?? 'Failed')
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPending(false)
    }
  }

  const goLabel = pending
    ? '…'
    : totalItems === 0
      ? 'Tap an item ☝'
      : paymentType === 'free'
        ? `GO — ${totalItems} item${totalItems > 1 ? 's' : ''} free`
        : paymentType === 'card'
          ? `GO — €${totalPrice.toFixed(2)} (Card)`
          : `GO — €${totalPrice.toFixed(2)}`

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Rent Out</Text>
            <View style={{ flexGrow: 1 }} />
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <CloseIcon />
            </Pressable>
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 12 }}>
            {rentalItems.map(item => {
              const qty = cart[item.id] ?? 0
              const stock = stockFor(item)
              const selected = qty > 0
              return (
                <View key={item.id} style={[styles.itemCard, selected && styles.itemCardSelected]}>
                  <Pressable style={styles.itemBody} onPress={() => adjust(item, 1)} disabled={stock === 0}>
                    <View style={{ flexGrow: 1 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemStock}>{stock} available</Text>
                    </View>
                    {selected ? (
                      <Text style={styles.itemQty}>{qty}</Text>
                    ) : (
                      <Text style={styles.itemPlus}>+</Text>
                    )}
                  </Pressable>
                  {selected && (
                    <View style={styles.qtyRow}>
                      <Pressable style={[styles.qtyBtn, { borderColor: '#fecaca' }]} onPress={() => adjust(item, -1)}>
                        <Text style={[styles.qtyBtnText, { color: colors.danger }]}>−</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.qtyBtn, { borderColor: '#bbf7d0' }, qty >= stock && { opacity: 0.4 }]}
                        onPress={() => adjust(item, 1)}
                        disabled={qty >= stock}
                      >
                        <Text style={[styles.qtyBtnText, { color: '#16a34a' }]}>+</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )
            })}

            <View style={styles.durationRow}>
              {([1, 2, 3] as const).map(h => {
                const active = durationType === 'hours' && hours === h
                return (
                  <Pressable
                    key={h}
                    style={[styles.durBtn, active && styles.durBtnActive]}
                    onPress={() => {
                      setDurationType('hours')
                      setHours(h)
                    }}
                  >
                    <Text style={[styles.durText, active && styles.durTextActive]}>{h}h</Text>
                  </Pressable>
                )
              })}
              <Pressable
                style={[styles.durBtn, durationType === 'days' && styles.durBtnActive]}
                onPress={() => setDurationType('days')}
              >
                <Text style={[styles.durText, durationType === 'days' && styles.durTextActive]}>All day</Text>
              </Pressable>
            </View>

            <Pressable onPress={() => setMoreOpen(o => !o)} style={styles.moreToggle}>
              <Text style={styles.moreToggleText}>{moreOpen ? 'Less options ▲' : 'More options ▼'}</Text>
            </Pressable>

            {moreOpen && (
              <View style={{ gap: 10 }}>
                <TextInput
                  style={styles.input}
                  placeholder="Guest name (optional)"
                  placeholderTextColor={colors.faint}
                  value={guestName}
                  onChangeText={setGuestName}
                />
                {durationType === 'hours' && (
                  <View style={styles.stepperRow}>
                    <Pressable style={styles.stepBtn} onPress={() => setHours(h => Math.max(1, h - 1))}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </Pressable>
                    <Text style={styles.stepValue}>{hours}h</Text>
                    <Pressable style={styles.stepBtn} onPress={() => setHours(h => Math.min(12, h + 1))}>
                      <Text style={styles.stepBtnText}>+</Text>
                    </Pressable>
                  </View>
                )}
                <View style={styles.payRow}>
                  {(['cash', 'card', 'free'] as const).map(pt => {
                    const active = paymentType === pt
                    return (
                      <Pressable
                        key={pt}
                        style={[styles.payToggle, active && styles.payToggleActive]}
                        onPress={() => setPaymentType(pt)}
                      >
                        <Text style={[styles.payToggleText, active && styles.payToggleTextActive]}>
                          {pt === 'cash' ? 'Cash' : pt === 'card' ? 'Card' : 'Free'}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}

            {error && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <Pressable
            style={[styles.goBtn, totalItems === 0 && styles.goBtnDisabled]}
            onPress={() => void submit()}
            disabled={pending}
          >
            {pending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.goText}>{goLabel}</Text>
            )}
          </Pressable>
        </View>
      </View>

      {cardBookingIds && (
        <CollectPaymentModal
          actions={rentalCollectActions(siteId, cardBookingIds, accessKey)}
          onSettled={onCreated}
          onClose={onCreated}
        />
      )}
    </Modal>
  )
}

function rentalCollectActions(siteId: string, bookingIds: string[], accessKey: string): CollectActions {
  return {
    create: () => rpc('collectRentalPayment', [siteId, bookingIds, accessKey]),
    poll: () => rpc('getRentalCollectStatus', [siteId, bookingIds[0], accessKey]),
    cancel: () => rpc('cancelRentalCollection', [siteId, bookingIds[0], accessKey]),
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 999, backgroundColor: colors.borderInput, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading },
  closeBtn: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  itemCard: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 14 },
  itemCardSelected: { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  itemBody: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  itemName: { fontSize: 17, fontWeight: '800', color: colors.heading },
  itemStock: { fontSize: 13, color: colors.muted, marginTop: 2 },
  itemQty: { fontSize: 26, fontWeight: '900', color: '#16a34a', minWidth: 34, textAlign: 'center' },
  itemPlus: { fontSize: 24, fontWeight: '300', color: colors.faint, minWidth: 34, textAlign: 'center' },
  qtyRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  qtyBtn: {
    flexGrow: 1, flexBasis: 0, height: 42, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff',
  },
  qtyBtnText: { fontSize: 20, fontWeight: '700' },
  durationRow: { flexDirection: 'row', gap: 8 },
  durBtn: {
    flexGrow: 1, flexBasis: 0, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderInput, alignItems: 'center', backgroundColor: colors.cardBg,
  },
  durBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  durText: { fontSize: 14, fontWeight: '600', color: colors.body },
  durTextActive: { color: '#ffffff' },
  moreToggle: { alignItems: 'center', paddingVertical: 4 },
  moreToggleText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  input: {
    borderWidth: 1, borderColor: colors.borderInput, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: colors.heading,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  stepBtn: {
    width: 42, height: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.borderInput,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { fontSize: 18, color: colors.body },
  stepValue: { fontSize: 16, fontWeight: '700', color: colors.heading, minWidth: 44, textAlign: 'center' },
  payRow: { flexDirection: 'row', gap: 8 },
  payToggle: {
    flexGrow: 1, flexBasis: 0, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderInput, alignItems: 'center',
  },
  payToggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  payToggleText: { fontSize: 14, fontWeight: '600', color: colors.body },
  payToggleTextActive: { color: '#ffffff' },
  errorCard: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 12 },
  errorText: { fontSize: 13, color: '#b91c1c' },
  goBtn: {
    height: 60, borderRadius: 14, backgroundColor: '#16a34a',
    alignItems: 'center', justifyContent: 'center',
  },
  goBtnDisabled: { backgroundColor: colors.borderInput },
  goText: { fontSize: 19, fontWeight: '800', color: '#ffffff' },
})
