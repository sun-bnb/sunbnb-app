import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Current-worker persistence, per site — the mobile analogue of the web's
 * `sunbnb-manage-worker-{siteId}` localStorage key. The id is validated
 * against the live roster on load; a stale id is dropped silently, mirroring
 * the web behaviour.
 */
const keyFor = (siteId: string) => `sunbnb-worker-${siteId}`

export async function loadWorkerId(
  siteId: string,
  roster: { id: string }[],
): Promise<string | null> {
  const id = await AsyncStorage.getItem(keyFor(siteId))
  if (!id) return null
  if (!roster.some(e => e.id === id)) {
    await AsyncStorage.removeItem(keyFor(siteId))
    return null
  }
  return id
}

export async function saveWorkerId(siteId: string, id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(keyFor(siteId), id)
  else await AsyncStorage.removeItem(keyFor(siteId))
}

/** "María García" → "MG", "solo" → "SO" — the web FAB's initials rule. */
export function workerInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
