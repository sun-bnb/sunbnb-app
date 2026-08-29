/**
 * Rentals tab — RN port of the web RentalsSection + RentalBookingCard:
 * out/waiting counters, Rent Out, and per-booking Give/Back with the
 * cash-collect path. Returned/canceled bookings are filtered server-side.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  OP_PICKED_UP, OP_RESERVED, RESERVATION_PAID_IN_CASH,
} from '@repo/data/reservation-status'
import type { RentalBookingProps } from '@repo/floor-core/types'
import CollectPaymentModal, { type CollectActions } from '@/components/CollectPaymentModal'
import CreateRentalModal from '@/components/CreateRentalModal'
import { rpc } from '@/lib/api'
import { refreshGrid, useGridStore } from '@/lib/grid-store'
import { useWorkerId } from '@/lib/use-worker-id'
import { colors } from '@/theme'

const fmtTime = (d: unknown) => {
  const date = new Date(d as string)
  return isNaN(date.getTime())
    ? ''
    : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default function Rentals() {
  const insets = useSafeAreaInsets()
  const { pairing, grid } = useGridStore()
  const workerId = useWorkerId(pairing, grid)
  const [showCreate, setShowCreate] = useState(false)

  const bookings = useMemo(() => grid?.site.rentalBookings ?? [], [grid])
  const rentalItems = grid?.site.rentalItems ?? []
  const outCount = bookings.filter(b => b.operationalStatus === OP_PICKED_UP).length
  const waitingCount = bookings.filter(b => b.operationalStatus === OP_RESERVED).length

  if (!grid) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flexGrow: 1 }}>
          <Text style={styles.title}>Rentals</Text>
          {bookings.length > 0 && (
            <Text style={styles.counts}>
              {outCount} out
              {waitingCount > 0 && <Text style={{ color: '#ca8a04' }}> · {waitingCount} waiting</Text>}
            </Text>
          )}
        </View>
        {rentalItems.length > 0 && (
          <Pressable style={styles.rentOutBtn} onPress={() => setShowCreate(true)}>
            <Text style={styles.rentOutText}>+ Rent Out</Text>
          </Pressable>
        )}
      </View>
      <FlatList
        data={bookings}
        keyExtractor={b => b.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No active rentals</Text>}
        renderItem={({ item }) => (
          <BookingCard
            booking={item}
            siteId={pairing!.siteId}
            accessKey={pairing!.accessKey}
          />
        )}
      />
      {showCreate && pairing && (
        <CreateRentalModal
          siteId={pairing.siteId}
          accessKey={pairing.accessKey}
          rentalItems={rentalItems}
          activeBookings={bookings}
          workerId={workerId ?? undefined}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            void refreshGrid()
          }}
        />
      )}
    </View>
  )
}

function BookingCard({
  booking, siteId, accessKey,
}: {
  booking: RentalBookingProps
  siteId: string
  accessKey: string
}) {
  const [pending, setPending] = useState(false)
  const [collecting, setCollecting] = useState(false)

  const reserved = booking.operationalStatus === OP_RESERVED
  const pickedUp = booking.operationalStatus === OP_PICKED_UP
  const paidOnline = !!booking.paymentRef
  const hourly = booking.durationType === 'hours'
  const overdue = pickedUp && hourly && Date.now() > new Date(booking.to).getTime()
  const customer = booking.guestName || booking.user?.name || booking.user?.email
  const collectible = booking.status === RESERVATION_PAID_IN_CASH && !booking.paymentRef

  async function transition(action: 'markRentalPickedUp' | 'markRentalReturned') {
    if (pending) return
    setPending(true)
    try {
      await rpc(action, [siteId, booking.id, accessKey])
      await refreshGrid()
    } finally {
      setPending(false)
    }
  }

  return (
    <View
      style={[
        styles.card,
        reserved && { borderColor: '#facc15', backgroundColor: '#fefce8' },
        pickedUp && { borderColor: '#60a5fa', backgroundColor: '#eff6ff' },
      ]}
    >
      <View style={styles.cardRow}>
        <Text style={styles.cardName}>
          {booking.rentalItem.name}
          {booking.quantity > 1 && <Text style={styles.cardQty}> ×{booking.quantity}</Text>}
        </Text>
        <View style={{ flexGrow: 1 }} />
        {paidOnline && (
          <View style={styles.paidChip}>
            <Text style={styles.paidChipText}>Paid</Text>
          </View>
        )}
        {pickedUp && booking.pickedUpAt && (
          <Text style={styles.sinceText}>since {fmtTime(booking.pickedUpAt)}</Text>
        )}
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardSub}>
          {hourly ? `${fmtTime(booking.from)} – ${fmtTime(booking.to)}` : 'All day'}
        </Text>
        <View style={{ flexGrow: 1 }} />
        {pickedUp && hourly && (
          <Text style={[styles.cardSub, overdue && { color: colors.danger, fontWeight: '700' }]}>
            {overdue ? 'overdue' : `due ${fmtTime(booking.to)}`}
          </Text>
        )}
      </View>
      {customer && <Text style={styles.cardSub}>{customer}</Text>}
      {collectible && (
        <Pressable style={styles.collectBtn} onPress={() => setCollecting(true)}>
          <Text style={styles.collectBtnText}>Collect payment</Text>
        </Pressable>
      )}
      {(reserved || pickedUp) && (
        <Pressable
          style={[styles.bigBtn, { backgroundColor: reserved ? '#2563eb' : '#16a34a' }]}
          disabled={pending}
          onPress={() => void transition(reserved ? 'markRentalPickedUp' : 'markRentalReturned')}
        >
          {pending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.bigBtnText}>{reserved ? 'Give' : 'Back ✓'}</Text>
          )}
        </Pressable>
      )}
      {collecting && (
        <CollectPaymentModal
          actions={rentalCollect(siteId, booking.id, accessKey)}
          onSettled={() => void refreshGrid()}
          onClose={() => setCollecting(false)}
        />
      )}
    </View>
  )
}

function rentalCollect(siteId: string, bookingId: string, accessKey: string): CollectActions {
  return {
    create: () => rpc('collectRentalPayment', [siteId, [bookingId], accessKey]),
    poll: () => rpc('getRentalCollectStatus', [siteId, bookingId, accessKey]),
    cancel: () => rpc('cancelRentalCollection', [siteId, bookingId, accessKey]),
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.cardBg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.chipBg,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading },
  counts: { fontSize: 12, color: colors.muted, marginTop: 1 },
  rentOutBtn: {
    backgroundColor: '#16a34a', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10,
  },
  rentOutText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  listContent: { padding: 12, gap: 10 },
  empty: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 40 },
  card: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 6, backgroundColor: colors.cardBg, borderColor: colors.border },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 17, fontWeight: '800', color: colors.heading },
  cardQty: { fontSize: 14, fontWeight: '400', color: colors.muted },
  cardSub: { fontSize: 13, color: colors.muted },
  sinceText: { fontSize: 12, color: '#1d4ed8' },
  paidChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#dcfce7',
  },
  paidChipText: { fontSize: 11, fontWeight: '700', color: '#15803d' },
  collectBtn: {
    height: 44, borderRadius: 10, backgroundColor: '#2563eb',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  collectBtnText: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  bigBtn: {
    height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  bigBtnText: { fontSize: 19, fontWeight: '800', color: '#ffffff' },
})
