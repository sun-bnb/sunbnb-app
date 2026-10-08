import { useEffect, useState } from 'react'
import { Tabs } from 'expo-router'
import { loadPairing, type Pairing } from '@/lib/pairing'
import { floorCardPresent, useSitePayments } from '@/lib/site-context'
import { TapToPayProvider } from '@/lib/tap-to-pay'
import { colors } from '@/theme'
import { BedsIcon, GuestsIcon, RentalsIcon, TodayIcon } from '@/components/icons'

export default function TabsLayout() {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const isAdmin = pairing?.isAdmin ?? false
  // Stripe Tap to Pay venues get the Terminal SDK provider around the whole paired tree.
  const tapToPay = floorCardPresent(useSitePayments(pairing)) === 'tap-to-pay'

  useEffect(() => {
    loadPairing().then(setPairing)
  }, [])

  return (
    <TapToPayProvider siteId={pairing?.siteId ?? null} accessKey={pairing?.accessKey ?? null} enabled={tapToPay}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.faint,
          tabBarStyle: { backgroundColor: colors.cardBg, borderTopColor: colors.border },
        }}
      >
        <Tabs.Screen name="beds" options={{ title: 'Beds', tabBarIcon: ({ color, size }) => <BedsIcon color={String(color)} size={size} /> }} />
        <Tabs.Screen name="rentals" options={{ title: 'Rentals', tabBarIcon: ({ color, size }) => <RentalsIcon color={String(color)} size={size} /> }} />
        <Tabs.Screen name="guests" options={{ title: 'Guests', tabBarIcon: ({ color, size }) => <GuestsIcon color={String(color)} size={size} /> }} />
        {/* Admin surfaces (till summary · day close · trends) — hidden on non-admin keys */}
        <Tabs.Screen name="today" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <TodayIcon color={String(color)} size={size} />, href: isAdmin ? '/(tabs)/today' : null }} />
      </Tabs>
    </TapToPayProvider>
  )
}
