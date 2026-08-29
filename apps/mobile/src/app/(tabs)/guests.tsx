import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme'

export default function Screen() {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>Coming in the next build phase</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pageBg },
  text: { fontSize: 14, color: colors.muted },
})
