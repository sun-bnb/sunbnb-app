import { useEffect, useState } from 'react'
import { Tabs } from 'expo-router'
import { loadPairing } from '@/lib/pairing'
import { colors } from '@/theme'

export default function TabsLayout() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    loadPairing().then(p => setIsAdmin(p?.isAdmin ?? false))
  }, [])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.cardBg, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="beds" options={{ title: 'Beds' }} />
      <Tabs.Screen name="rentals" options={{ title: 'Rentals' }} />
      <Tabs.Screen name="guests" options={{ title: 'Guests' }} />
      {/* Admin surfaces (till summary · day close · trends) — hidden on non-admin keys */}
      <Tabs.Screen name="today" options={{ title: 'Today', href: isAdmin ? '/(tabs)/today' : null }} />
    </Tabs>
  )
}
