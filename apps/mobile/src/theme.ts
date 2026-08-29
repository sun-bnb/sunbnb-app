/**
 * Design tokens — the repo design language (.claude/rules/ui.md) translated to
 * RN color constants. One accent token; grid state colors mirror
 * @repo/floor-core/bed-state's Tailwind vocabulary exactly.
 */
export const colors = {
  accent: '#111827',
  accentHover: '#374151',
  pageBg: '#f9fafb',
  cardBg: '#ffffff',
  border: '#e5e7eb',
  borderInput: '#d1d5db',
  heading: '#111827',
  body: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  chipBg: '#f3f4f6',
  danger: '#dc2626',
  info: '#2563eb',
} as const

/** Grid cell palette keyed by BedState (+ failed/processing variants). */
export const bedColors = {
  available: { bg: '#86efac', border: '#22c55e', text: 'rgba(17,24,39,0.55)' },
  expected: { bg: '#e879f9', border: '#c026d3', text: 'rgba(74,4,78,0.75)' },
  'checked-in': { bg: '#f87171', border: '#dc2626', text: 'rgba(255,255,255,0.85)' },
  'walked-in': { bg: '#f87171', border: '#dc2626', text: 'rgba(255,255,255,0.85)' },
  blocked: { bg: '#9ca3af', border: '#4b5563', text: 'rgba(255,255,255,0.85)' },
  comp: { bg: '#38bdf8', border: '#0284c7', text: 'rgba(255,255,255,0.9)' },
} as const

export const statusTints = {
  occupied: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
  reserved: { bg: '#fdf4ff', border: '#f5d0fe', text: '#a21caf' },
  comp: { bg: '#f0f9ff', border: '#bae6fd', text: '#0369a1' },
  free: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
} as const

/**
 * getCellAppearance (@repo/floor-core/bed-state) returns Tailwind class
 * strings — the single derivation both platforms share. This maps its EXACT
 * outputs to RN colors; never derive cell colors from state independently.
 */
const A = {
  failed: { bg: '#fecaca', border: '#ef4444', text: '#b91c1c' },
  expected: { bg: '#e879f9', border: '#c026d3', text: 'rgba(74,4,78,0.75)' },
  occupied: { bg: '#f87171', border: '#dc2626', text: 'rgba(255,255,255,0.85)' },
  available: { bg: '#86efac', border: '#22c55e', text: 'rgba(17,24,39,0.55)' },
  blocked: { bg: '#9ca3af', border: '#4b5563', text: 'rgba(255,255,255,0.85)' },
  comp: { bg: '#38bdf8', border: '#0284c7', text: 'rgba(255,255,255,0.9)' },
} as const

export const cellClassColors: Record<string, { bg: string; border: string; text: string }> = {
  'bg-red-200 border-red-500 text-red-700': A.failed,
  'bg-fuchsia-400 border-fuchsia-600 animate-pulse-slow': A.expected,
  'bg-fuchsia-400 border-fuchsia-600': A.expected,
  'bg-red-400 border-red-600 text-white': A.occupied,
  'bg-green-300 border-green-500': A.available,
  'bg-gray-400 border-gray-600 text-white': A.blocked,
  'bg-sky-400 border-sky-600 text-white': A.comp,
}

export function cellColors(twClasses: string) {
  return cellClassColors[twClasses] ?? A.available
}
