/**
 * Today tab (admin keys only) — bundles the web's three admin pages:
 * daily summary, day close, trends. Sections switch via a segmented header.
 */
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import DayCloseView from '@/components/today/DayCloseView'
import SummaryView from '@/components/today/SummaryView'
import TrendsView from '@/components/today/TrendsView'
import { useGridStore } from '@/lib/grid-store'
import { colors } from '@/theme'

type Section = 'summary' | 'close' | 'trends'

export default function Today() {
  const insets = useSafeAreaInsets()
  const { pairing, grid } = useGridStore()
  const [section, setSection] = useState<Section>('summary')

  if (!pairing || !grid) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }
  if (!grid.isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.gateText}>This page needs an admin access key.</Text>
      </View>
    )
  }
  const todayIso = grid.todayIso ?? new Date().toISOString().slice(0, 10)

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Today</Text>
        <View style={styles.segmented}>
          {(
            [
              ['summary', 'Summary'],
              ['close', 'Day close'],
              ['trends', 'Trends'],
            ] as [Section, string][]
          ).map(([key, label]) => {
            const active = section === key
            return (
              <Pressable
                key={key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setSection(key)}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      {section === 'summary' && (
        <SummaryView siteId={pairing.siteId} accessKey={pairing.accessKey} todayIso={todayIso} />
      )}
      {section === 'close' && (
        <DayCloseView siteId={pairing.siteId} accessKey={pairing.accessKey} todayIso={todayIso} />
      )}
      {section === 'trends' && <TrendsView siteId={pairing.siteId} accessKey={pairing.accessKey} />}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  gateText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  header: {
    backgroundColor: colors.cardBg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.chipBg, gap: 10,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading },
  segmented: {
    flexDirection: 'row', borderWidth: 1, borderColor: colors.borderInput,
    borderRadius: 8, padding: 2, gap: 2,
  },
  segment: {
    flexGrow: 1, flexBasis: 0, paddingVertical: 7, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  segmentTextActive: { color: '#ffffff', fontWeight: '600' },
})
