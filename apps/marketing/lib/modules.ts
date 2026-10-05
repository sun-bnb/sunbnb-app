/**
 * Which feature modules the demo plays after "your morning" (track 027 D10) — a deterministic
 * rule table over what the visitor told us, never the model's choice, so the demo can't show a
 * feature that isn't shipped. Every module here mirrors an entry in lib/agent/knowledge.ts
 * (Veri*factu as `coming`).
 */
import type { Run } from './intent.ts'

export type Module = 'order' | 'rental' | 'tables' | 'dayclose' | 'verifactu'

/** `runs`: null = they didn't answer; [] = "just sunbeds". */
export function planModules({ runs, spain }: { runs: readonly Run[] | null; spain: boolean }): Module[] {
  const plan: Module[] = []
  // Unanswered: show food & drink — the commonest extra on a beach — rather than nothing.
  if (runs === null || runs.includes('fnb')) plan.push('order')
  if (runs?.includes('rentals')) plan.push('rental')
  if (runs?.includes('tables')) plan.push('tables')
  plan.push('dayclose') // every venue closes a day: payments, cash, invoices
  if (spain) plan.push('verifactu')
  return plan
}

/** A Spanish beach, from the Places address in any of the page's languages (or Catalan). */
export function isSpanishAddress(address: string): boolean {
  return /\b(spain|españa|espanya|espanja)\b/i.test(address)
}
