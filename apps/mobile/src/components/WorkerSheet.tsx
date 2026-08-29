/**
 * Worker roster picker — the mobile form of the web ManageWorkerFab popover:
 * one row per employee, a Till entry when a worker is set, and "No worker".
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { BanknoteIcon, CheckIcon } from '@/components/icons'
import { workerInitials } from '@/lib/worker'
import { colors } from '@/theme'

export default function WorkerSheet({
  employees, currentWorkerId, onSelect, onOpenTill, onClose,
}: {
  employees: { id: string; name: string }[]
  currentWorkerId: string | null
  onSelect: (id: string | null) => void
  onOpenTill: () => void
  onClose: () => void
}) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Worker</Text>
          <ScrollView bounces={false} style={{ maxHeight: 380 }}>
            {employees.map(e => {
              const active = e.id === currentWorkerId
              return (
                <Pressable key={e.id} style={styles.row} onPress={() => onSelect(e.id)}>
                  <View style={[styles.avatar, active && { backgroundColor: colors.accent }]}>
                    <Text style={[styles.avatarText, active && { color: '#ffffff' }]}>
                      {workerInitials(e.name)}
                    </Text>
                  </View>
                  <Text style={[styles.rowText, active && { fontWeight: '600' }]} numberOfLines={1}>
                    {e.name}
                  </Text>
                  {active && <CheckIcon />}
                </Pressable>
              )
            })}
          </ScrollView>
          {currentWorkerId && (
            <>
              <View style={styles.divider} />
              <Pressable style={styles.row} onPress={onOpenTill}>
                <View style={[styles.avatar, { backgroundColor: '#f0fdf4' }]}>
                  <BanknoteIcon color="#16a34a" />
                </View>
                <Text style={styles.rowText}>Till</Text>
              </Pressable>
              <Pressable style={styles.row} onPress={() => onSelect(null)}>
                <Text style={[styles.rowText, { color: colors.muted }]}>No worker</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, gap: 6,
  },
  handle: {
    width: 36, height: 4, borderRadius: 999, backgroundColor: colors.borderInput,
    alignSelf: 'center', marginBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  avatar: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '600', color: colors.body },
  rowText: { fontSize: 15, color: colors.heading, flexShrink: 1, flexGrow: 1 },
  divider: { height: 1, backgroundColor: colors.chipBg, marginVertical: 4 },
})
