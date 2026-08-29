import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Redirect } from 'expo-router'
import { loadPairing } from '@/lib/pairing'
import { colors } from '@/theme'

/** Gate: paired devices land on the grid, fresh installs on pairing. */
export default function Index() {
  const [state, setState] = useState<'loading' | 'paired' | 'unpaired'>('loading')

  useEffect(() => {
    loadPairing().then(p => setState(p ? 'paired' : 'unpaired'))
  }, [])

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }
  return <Redirect href={state === 'paired' ? '/(tabs)/beds' : '/pairing'} />
}
