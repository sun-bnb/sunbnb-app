import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { getManageContext, isManageContext } from '@/lib/api'
import { parsePairingInput, savePairing } from '@/lib/pairing'
import { colors } from '@/theme'

/**
 * Pairing — paste the manage link (or "siteId:key") from the partner portal.
 * QR-camera scanning lands in a later pass; the parse + verify + store flow is
 * identical either way. The key is verified against /api/manage/context before
 * it is stored.
 */
export default function Pairing() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    const parsed = parsePairingInput(input)
    if (!parsed) {
      setError('Paste the full management link from the partner portal.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ctx = await getManageContext(parsed.siteId, parsed.key)
      if (!isManageContext(ctx)) {
        setError(ctx.errors?.[0] ?? 'This access key is not valid.')
        return
      }
      await savePairing({
        siteId: parsed.siteId,
        accessKey: parsed.key,
        siteName: ctx.site.name,
        isAdmin: ctx.isAdmin,
      })
      router.replace('/(tabs)/beds')
    } catch {
      setError('Could not reach the server. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.monogram}>
        <Text style={styles.monogramText}>S</Text>
      </View>
      <Text style={styles.title}>Pair this device</Text>
      <Text style={styles.subtitle}>
        Paste the management link shown in the partner portal to link this phone to your site.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="https://sunbnb.app/sites/…/manage?key=…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        value={input}
        onChangeText={setInput}
        editable={!busy}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.accentHover }]}
        onPress={connect}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Connect</Text>
        )}
      </Pressable>
      <Text style={styles.footnote}>
        One-time pairing — the access key is stored securely on this device.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
  },
  monogram: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: { fontSize: 28, fontWeight: '800', color: '#b45309' },
  title: { fontSize: 24, fontWeight: '800', color: colors.heading },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 280,
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.heading,
  },
  error: { fontSize: 13, color: colors.danger, textAlign: 'center' },
  button: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 10 },
})
