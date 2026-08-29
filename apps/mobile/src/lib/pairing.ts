import * as SecureStore from 'expo-secure-store'

/**
 * Device pairing — the mobile replacement for the access-key-in-a-URL
 * ([[track:024]]). The SecurityToken access key is scanned/pasted once and
 * lives in the platform keychain, never in a URL or async storage.
 */
export interface Pairing {
  siteId: string
  accessKey: string
  siteName: string
  isAdmin: boolean
}

const KEY = 'sunbnb-pairing'

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Pairing
    return p.siteId && p.accessKey ? p : null
  } catch {
    return null
  }
}

export async function savePairing(p: Pairing): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(p))
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY)
}

/**
 * Extract { siteId, key } from a pasted manage URL
 * (https://…/sites/<id>/manage…?key=<key>) or a "siteId:key" pair.
 */
export function parsePairingInput(input: string): { siteId: string; key: string } | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/sites\/([^/?]+)\/manage[^?]*\?.*key=([^&\s]+)/)
  if (urlMatch) return { siteId: urlMatch[1]!, key: urlMatch[2]! }
  const pairMatch = trimmed.match(/^([\w-]+):([\w-]+)$/)
  if (pairMatch) return { siteId: pairMatch[1]!, key: pairMatch[2]! }
  return null
}
