/**
 * The admin app for the environment this marketing site runs in: try → admin, trytest →
 * admintest (Vercel domains), local dev → port 3003. Null when the host is unrecognised.
 */
export function adminUrlFor(host: string): string | null {
  const h = host.split(':')[0]!.toLowerCase()
  if (h === 'try.sunbnb.app') return 'https://admin.sunbnb.app'
  if (h === 'trytest.sunbnb.app') return 'https://admintest.sunbnb.app'
  if (h === 'local.sunbnb.app' || h === 'localhost') return 'https://local.sunbnb.app:3003'
  return null
}
