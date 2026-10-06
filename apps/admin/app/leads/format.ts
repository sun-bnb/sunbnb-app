export const STATUS_STYLES: Record<string, string> = {
  mockup: 'bg-gray-800 text-gray-400 border-gray-700',
  demo_requested: 'bg-amber-950/40 text-amber-400 border-amber-900',
  contacted: 'bg-blue-950/40 text-blue-400 border-blue-900',
  converted: 'bg-green-950/40 text-green-400 border-green-900',
  closed: 'bg-red-950/40 text-red-400 border-red-900',
}

export function statusLabel(s: string) {
  return s.replace(/_/g, ' ')
}

export function scoreStyle(score: number) {
  if (score >= 60) return 'bg-green-950/40 text-green-400 border-green-900'
  if (score >= 30) return 'bg-amber-950/40 text-amber-400 border-amber-900'
  return 'bg-gray-800 text-gray-400 border-gray-700'
}

export function relativeTime(d: Date, now = new Date()) {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 60) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

export function humanizeEvent(name: string) {
  const t = name.replace(/[_-]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://try.sunbnb.app'
