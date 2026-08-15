/**
 * Coverage-contract meta-test — Phase 0.3 of the partner test-architecture track.
 *
 * Statically enumerates every exported 'use server' action + every HTTP-method
 * route handler in the partner app, then asserts that each one is either:
 *   (a) present in the GATED_ACTIONS registry (gated-actions.ts), OR
 *   (b) on the explicit UNGATED_ALLOWLIST with a documented reason.
 *
 * This makes it structurally impossible to add a backend export that silently
 * escapes the test harness. Any new 'use server' export or route handler that
 * isn't registered or allowlisted will cause this test to fail with a clear
 * "file + export" report.
 *
 * Enumeration strategy: pure static regex over the source file text — no
 * imports, no side effects, no server-module execution. This avoids the
 * server-only import problem that comes with import-and-reflect.
 *
 * Precision on duplicate bare names: the registry is parsed for both the
 * bare export name (after the last '.') AND the source file path (derived
 * from the import statements in gated-actions.ts). Matching is done at the
 * (file, export) level so a shared bare name between two distinct files can't
 * produce a false pass for a third unregistered export.
 *
 * Source-path derivation: gated-actions.ts imports real action functions by
 * name; the contract test parses those import lines to build a symbol→file map.
 * A registry entry's covered (file, export) pairs = all imports of the bare name
 * in gated-actions.ts that map to an action file. This is conservative: an
 * unregistered export with the same name as a registered one WILL be caught if
 * it lives in a file not imported by gated-actions.ts.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'glob'

// ─── Paths ───────────────────────────────────────────────────────────────────

const APP_ROOT = path.resolve(__dirname, '..')         // apps/partner/app
const PARTNER_ROOT = path.resolve(__dirname, '../..')   // apps/partner
const GATED_ACTIONS_FILE = path.resolve(__dirname, 'gated-actions.ts')

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve an @/ alias path to an absolute file path */
function resolveAlias(aliasPath: string): string {
  // @/ → apps/partner/  (the PARTNER_ROOT, not APP_ROOT)
  return path.resolve(PARTNER_ROOT, aliasPath.replace(/^@\//, '') + '.ts')
}

/**
 * Parse all named imports from a TypeScript source file.
 * Returns a map from imported symbol name → resolved absolute file path.
 *
 * Handles:
 *   import { foo, bar } from '@/app/path'
 *   import { foo as localFoo } from '@/app/path'   (maps localFoo → file)
 */
function parseImportedSymbols(filePath: string): Map<string, string> {
  const src = fs.readFileSync(filePath, 'utf-8')
  const symbolToFile = new Map<string, string>()

  // Match: import { ... } from 'specifier'
  const importRe = /^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm
  for (const m of src.matchAll(importRe)) {
    const specifiers = m[1]
    const specifier = m[2]

    // Only care about @/ aliased imports (our app's source files)
    if (!specifier.startsWith('@/')) continue

    const resolvedFile = resolveAlias(specifier)

    // Parse each symbol, handling `original as alias`
    for (const part of specifiers.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const asParts = trimmed.split(/\s+as\s+/)
      const localName = (asParts[1] ?? asParts[0]).trim()
      const originalName = asParts[0].trim()
      // The original exported name is the real function name
      symbolToFile.set(localName, resolvedFile)
      if (asParts[1]) {
        // also record original → file in case we need it
        symbolToFile.set(originalName, resolvedFile)
      }
    }
  }

  return symbolToFile
}

/**
 * Parse all `name: 'domain.export'` values from the GATED_ACTIONS array in
 * gated-actions.ts. Returns an array of bare export names (after last '.').
 */
function parseRegistryNames(): string[] {
  const src = fs.readFileSync(GATED_ACTIONS_FILE, 'utf-8')
  const names: string[] = []
  for (const m of src.matchAll(/\bname:\s*['"]([^'"]+)['"]/g)) {
    names.push(m[1])
  }
  return names
}

/** Extract the bare export name from a registry `domain.export` name */
function bareName(registryName: string): string {
  return registryName.split('.').pop()!
}

/**
 * Extract exported function names from a TypeScript file that has 'use server'
 * at the top. Captures:
 *   export (async) function name
 *   export const name = async? (...) =>   or   = function
 */
function parseServerActionExports(filePath: string): string[] {
  const src = fs.readFileSync(filePath, 'utf-8')
  const names: string[] = []

  // export (async) function name
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    names.push(m[1])
  }
  // export const name = (async?) (...) => or = function
  for (const m of src.matchAll(/^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/gm)) {
    names.push(m[1])
  }

  return names
}

/**
 * Check if a file has the 'use server' directive at the top (first non-blank,
 * non-comment line, or within the first 5 lines).
 */
function hasUseServerDirective(filePath: string): boolean {
  const src = fs.readFileSync(filePath, 'utf-8')
  // Check first 400 chars — directive is always near the top
  const head = src.slice(0, 400)
  return /['"]use server['"]/.test(head)
}

/**
 * Extract exported HTTP-method names from a route.ts file.
 * Captures GET, POST, PUT, PATCH, DELETE exported functions or consts.
 */
function parseRouteHandlerExports(filePath: string): string[] {
  const src = fs.readFileSync(filePath, 'utf-8')
  const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  const found: string[] = []

  // export (async) function GET / POST etc.
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    if (httpMethods.has(m[1])) found.push(m[1])
  }
  // export const { GET, POST } = handlers  (destructuring from NextAuth)
  for (const m of src.matchAll(/^export\s+const\s+\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim()
      if (httpMethods.has(name)) found.push(name)
    }
  }
  // export const GET = ...
  for (const m of src.matchAll(/^export\s+const\s+(\w+)\s*=/gm)) {
    if (httpMethods.has(m[1])) found.push(m[1])
  }

  return [...new Set(found)]
}

// ─── Covered set ─────────────────────────────────────────────────────────────

/**
 * Build the set of (file, export) pairs covered by the GATED_ACTIONS registry.
 *
 * Strategy:
 * 1. Parse the registry's `name` fields to get bare export names.
 * 2. Parse the import statements in gated-actions.ts to build
 *    symbol → resolvedFile maps (handles `foo as ordersToggleProductSoldOut` aliases).
 * 3. For each registry name, the bare name IS the local symbol used in gated-actions.ts
 *    OR if aliased, we track the original→file mapping too.
 *
 * This handles the known duplicate: `toggleProductSoldOut` exists in both
 * orders/actions.ts and products/actions.ts. Both are aliased and registered
 * under different registry names; both (file, export) pairs are covered.
 */
function buildCoveredSet(): Set<string> {
  const symbolToFile = parseImportedSymbols(GATED_ACTIONS_FILE)
  const registryNames = parseRegistryNames()
  const covered = new Set<string>()

  // Also parse `original as alias` pairs specially — gated-actions.ts uses:
  //   import { toggleProductSoldOut as ordersToggleProductSoldOut } from 'orders/actions'
  //   import { toggleProductSoldOut as productsToggleProductSoldOut } from 'products/actions'
  // The registry then uses bare names like 'orders.toggleProductSoldOut' and
  // 'products.toggleProductSoldOut'. The local alias is what's registered; we
  // need to map back from alias → original export name in the file.
  //
  // We also parse the original→file mapping for bare-name matching below.

  // Parse gated-actions.ts for alias pairs: { original as alias } → (alias, original, file)
  const gatedSrc = fs.readFileSync(GATED_ACTIONS_FILE, 'utf-8')
  const aliasMap = new Map<string, { original: string; file: string }>() // localAlias → {original, file}

  const importRe = /^import\s*\{([^}]+)\}\s*from\s*['"](@\/[^'"]+)['"]/gm
  for (const m of gatedSrc.matchAll(importRe)) {
    const specifiers = m[1]
    const specifier = m[2]
    const resolvedFile = resolveAlias(specifier)

    for (const part of specifiers.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const asParts = trimmed.split(/\s+as\s+/)
      if (asParts.length === 2) {
        const original = asParts[0].trim()
        const alias = asParts[1].trim()
        aliasMap.set(alias, { original, file: resolvedFile })
      }
    }
  }

  // Build a reverse index: original export name → all files it's imported from
  // (needed for aliased imports where `original as alias` maps original → file)
  const originalToFiles = new Map<string, string[]>()
  for (const { original, file } of aliasMap.values()) {
    const list = originalToFiles.get(original) ?? []
    list.push(file)
    originalToFiles.set(original, list)
  }

  for (const name of registryNames) {
    const bare = bareName(name)

    // Try: the bare name IS a local symbol imported directly (no alias)
    if (symbolToFile.has(bare)) {
      const file = symbolToFile.get(bare)!
      covered.add(`${file}::${bare}`)
    }

    // Try: the bare name IS a local alias — map back to the original export name
    // e.g. registry name 'manage.createPoolSeat' → bare 'createPoolSeat' IS a local alias
    // (only if gated-actions.ts imported it as `createPoolSeat as something`)
    if (aliasMap.has(bare)) {
      const { original, file } = aliasMap.get(bare)!
      covered.add(`${file}::${original}`)
    }

    // Try: the bare name IS the original export name used in an aliased import
    // e.g. registry name 'orders.toggleProductSoldOut' → bare 'toggleProductSoldOut'
    // was imported as `toggleProductSoldOut as ordersToggleProductSoldOut`
    // The alias map stores { original: 'toggleProductSoldOut', file: 'orders/actions.ts' }
    // under key 'ordersToggleProductSoldOut'. We need the reverse lookup.
    if (originalToFiles.has(bare)) {
      for (const file of originalToFiles.get(bare)!) {
        covered.add(`${file}::${bare}`)
      }
    }
  }


  return covered
}

// ─── UNGATED_ALLOWLIST ───────────────────────────────────────────────────────
//
// Entries for backend exports that are deliberately NOT in the gated-actions
// registry. Each entry must document a real gate or a justified architectural
// reason. This list is the only place where an ungated export can live without
// failing the contract.

interface AllowlistEntry {
  /** Bare export name (function or HTTP method) */
  export: string
  /** Relative path from PARTNER_ROOT to the file */
  file: string
  /** The real gate or reason this export is safe ungated */
  reason: string
}

const UNGATED_ALLOWLIST: AllowlistEntry[] = [
  // ── Route handlers: auth (NextAuth framework routes) ──────────────────────
  {
    export: 'GET',
    file: 'app/api/auth/[...nextauth]/route.ts',
    reason: 'NextAuth framework route — gated internally by NextAuth session/provider logic',
  },
  {
    export: 'POST',
    file: 'app/api/auth/[...nextauth]/route.ts',
    reason: 'NextAuth framework route — gated internally by NextAuth session/provider logic',
  },

  // ── Route handlers: auth (forgot/reset password — rate-limited public) ────
  {
    export: 'POST',
    file: 'app/api/auth/forgot-password/route.ts',
    reason: 'Public rate-limited endpoint (rateLimit helper, 3/hr per email); enumeration-protected. Covered by forgot-password/route.test.ts',
  },
  {
    export: 'POST',
    file: 'app/api/auth/reset-password/route.ts',
    reason: 'Public rate-limited endpoint (rateLimit helper); token hashed before storage. Covered by reset-password/route.test.ts',
  },

  // ── Route handlers: impersonate (sudo-gated session endpoints) ────────────
  {
    export: 'GET',
    file: 'app/api/auth/impersonate/route.ts',
    reason: 'Session-gated sudo-only endpoint; checks session.user.sudo before acting',
  },
  {
    export: 'GET',
    file: 'app/api/auth/end-impersonation/route.ts',
    reason: 'Session-gated; ends impersonation by clearing the override cookie',
  },

  // ── Route handlers: cron (CRON_SECRET header-gated) ───────────────────────
  {
    export: 'GET',
    file: 'app/api/reservations-cleanup/route.ts',
    reason: 'Cron route — gated by CRON_SECRET in Authorization: Bearer header. Covered by reservations-cleanup/route.test.ts',
  },

  // ── Route handlers: subscription webhook (Stripe signature-gated) ─────────
  {
    export: 'POST',
    file: 'app/api/subscription/webhook/route.ts',
    reason: 'Stripe webhook — gated by stripe-signature header verification (constructEventAsync). Covered by subscription/webhook/route.test.ts',
  },

  // ── Route handlers: reservations API (session + ownership-gated) ──────────
  {
    export: 'GET',
    file: 'app/api/reservations/[siteId]/route.ts',
    reason: 'Session-gated + site ownership check (site.userId !== session.user.id → 403). Covered by reservations/[siteId]/route.test.ts',
  },

  // ── Route handlers: onboarding-status (session-scoped, returns safe nulls) ─
  {
    export: 'GET',
    file: 'app/api/onboarding-status/route.ts',
    reason: 'Session-scoped: unauthenticated returns { hasAccount: false, hasMollie: false }; all queries filtered by session.user.id',
  },

  // ── Route handlers: Mollie OAuth (session-gated) ──────────────────────────
  {
    export: 'GET',
    file: 'app/api/mollie/authorize/route.ts',
    reason: 'Session-gated Mollie OAuth initiation (auth() check, 401 if not authenticated)',
  },
  {
    export: 'GET',
    file: 'app/api/mollie/callback/route.ts',
    reason: 'Session-gated Mollie OAuth callback (auth() check, redirects to error if not authenticated)',
  },
  {
    export: 'POST',
    file: 'app/api/mollie/client-link/route.ts',
    reason: 'Session-gated Mollie client-link creation (auth() check, 401 if not authenticated)',
  },
  {
    export: 'GET',
    file: 'app/api/mollie/readiness-check/route.ts',
    reason: 'Session-gated Mollie readiness check (auth() check, 401 if not authenticated; all queries scoped to session.user.id)',
  },
  {
    export: 'POST',
    file: 'app/api/mollie/setup-test-merchant/route.ts',
    reason: 'Session-gated test-mode Mollie bootstrap (auth() check, 401 if not authenticated; scoped to session.user.id)',
  },

  // ── Route handlers: subscription (session-gated Stripe flows) ─────────────
  {
    export: 'POST',
    file: 'app/api/subscription/checkout/route.ts',
    reason: 'Session-gated Stripe checkout session creation (auth() check, 401 if not authenticated)',
  },
  {
    export: 'POST',
    file: 'app/api/subscription/portal/route.ts',
    reason: 'Session-gated Stripe billing portal (auth() check, 401 if not authenticated)',
  },

  // ── Server actions: account (session-scoped personal account mutations) ────
  {
    export: 'submitForm',
    file: 'app/account/actions.ts',
    reason: 'Session-only: updates the session user\'s own PartnerAccount (scoped to session.user.id); no cross-user data access possible',
  },

  // ── Server actions: account/mollie (session-scoped Mollie token ops) ───────
  {
    export: 'disconnectMollie',
    file: 'app/account/mollie/actions.ts',
    reason: 'Session-gated: clears Mollie fields on session.user\'s own PartnerAccount (where: { userId: session.user.id })',
  },
  {
    export: 'refreshMollieTokens',
    file: 'app/account/mollie/actions.ts',
    reason: 'Session-gated: refreshes tokens for session.user\'s own PartnerAccount (getValidMollieToken(session.user.id))',
  },

  // ── Server actions: account/subscription (session-scoped subscription read) ─
  {
    export: 'getSubscriptionData',
    file: 'app/account/subscription/actions.ts',
    reason: 'Session-gated read: all queries scoped to session.user.id!; returns null for unauthenticated',
  },

  // ── Server actions: security (session-scoped token management) ────────────
  {
    export: 'getTokens',
    file: 'app/security/actions.ts',
    reason: 'Session-gated: securityToken.findMany where { userId: session.user.id }; throws if not authenticated',
  },
  {
    export: 'getOwnedSites',
    file: 'app/security/actions.ts',
    reason: 'Session-gated: site.findMany where { userId: session.user.id }; throws if not authenticated',
  },
  {
    export: 'createToken',
    file: 'app/security/actions.ts',
    reason: 'Session-gated: creates SecurityToken scoped to session.user.id; throws if not authenticated',
  },
  {
    export: 'deleteToken',
    file: 'app/security/actions.ts',
    reason: 'Session-gated: securityToken.delete where { id, userId: session.user.id }; throws if not authenticated; user can only delete their own tokens',
  },

  // ── Server actions: accounting (session + site ownership) ─────────────────
  {
    export: 'getInvoicesByMonth',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated: invoice.findMany where { accountId: session.user.id, issuerType: PARTNER }; scoped to own account',
  },
  {
    export: 'getPaidItemsByMonth',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; all data scoped to verified siteId',
  },
  {
    export: 'getRevenueTrend',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; aggregation scoped to verified siteId via @repo/data/analytics',
  },
  {
    export: 'getOccupancyTrend',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; occupancy aggregation scoped to verified siteId via @repo/data/analytics',
  },
  {
    export: 'getRevenueCsv',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; serializes verified-siteId revenue to CSV via @repo/data/analytics',
  },
  {
    export: 'getStaffTill',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; per-employee cash breakdown scoped to verified siteId via @repo/data/till getTillByEmployee',
  },
  {
    export: 'getOperationsTrend',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; per-day reservation stats scoped to verified siteId via @repo/data/analytics getReservationDayStats',
  },
  {
    export: 'getStaffShiftItems',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; per-employee shift items scoped to verified siteId via @repo/data/till getEmployeeShiftItems',
  },
  {
    export: 'getFloorSnapshot',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; 5-way floor-state snapshot scoped to verified siteId via @repo/data/analytics getFloorStateSnapshot',
  },
  {
    export: 'getStaffShiftItemsForDay',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; per-employee shift items for a single civil UTC day via @repo/data/till getEmployeeShiftItems',
  },
  {
    export: 'getMonthlyTakings',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; calendar-month takings summary scoped to verified siteId via @repo/data/analytics getReservationDayStats',
  },
  {
    export: 'getRevenueChannelTrend',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; per-day channel revenue (cash/qr/online) scoped to verified siteId via @repo/data/analytics getRevenueByChannelByDay',
  },
  {
    export: 'getMonthlySummary',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; all-source monthly takings summary (sunbeds/rentals/orders/refunds + prev-month delta) scoped to verified siteId via @repo/data/analytics getMonthlySourceSummary',
  },
  {
    export: 'getMonthlyFiscalReport',
    file: 'app/sites/[id]/accounting/actions.ts',
    reason: 'Session-gated + site ownership: fetches site, checks site.userId !== session.user.id → throws; invoice-based fiscal summary (gross/net/VAT/platform commission/fees/refunds) scoped to verified siteId via @repo/data/fiscal getMonthlyFiscalReport',
  },

  // ── Server actions: reservations/[id] (session + reservation ownership) ────
  {
    export: 'checkInReservation',
    file: 'app/reservations/[id]/actions.ts',
    reason: 'Session + reservation ownership: verifyOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'markDeparted',
    file: 'app/reservations/[id]/actions.ts',
    reason: 'Session + reservation ownership: verifyOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'markNoShow',
    file: 'app/reservations/[id]/actions.ts',
    reason: 'Session + reservation ownership: verifyOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'cancelReservation',
    file: 'app/reservations/[id]/actions.ts',
    reason: 'Session + reservation ownership: verifyOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'updateNotes',
    file: 'app/reservations/[id]/actions.ts',
    reason: 'Session + reservation ownership: verifyOwnership() checks reservation.site.userId === session.user.id',
  },

  // ── Server actions: frontdesk (session + reservation/rental ownership) ─────
  {
    export: 'searchAllReservations',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session-gated: fetches siteIds where { userId: session.user.id }; all queries scoped to those siteIds; returns empty on unauthenticated',
  },
  {
    export: 'checkInReservation',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + reservation ownership: verifyReservationOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'markDeparted',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + reservation ownership: verifyReservationOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'markNoShow',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + reservation ownership: verifyReservationOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'cancelReservation',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + reservation ownership: verifyReservationOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'updateNotes',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + reservation ownership: verifyReservationOwnership() checks reservation.site.userId === session.user.id',
  },
  {
    export: 'markRentalPickedUp',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + rental ownership: verifyRentalOwnership() checks booking.site.userId === session.user.id',
  },
  {
    export: 'markRentalReturned',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + rental ownership: verifyRentalOwnership() checks booking.site.userId === session.user.id',
  },
  {
    export: 'cancelRentalBooking',
    file: 'app/frontdesk/actions.ts',
    reason: 'Session + rental ownership: verifyRentalOwnership() checks booking.site.userId === session.user.id',
  },

  // ── Server actions: locale (no auth — stateless cookie write) ─────────────
  {
    export: 'setLocale',
    file: 'app/locale/actions.ts',
    reason: 'No-auth locale cookie write — sets NEXT_LOCALE cookie only; no data access, no user-scoped resource mutations',
  },

  // ── Server actions: account/staff (session-account-scoped employee CRUD) ────
  {
    export: 'getEmployees',
    file: 'app/account/staff/actions.ts',
    reason: 'Session-gated: employee.findMany where { accountId: session.user.id }; throws if not authenticated',
  },
  {
    export: 'createEmployee',
    file: 'app/account/staff/actions.ts',
    reason: 'Session-gated: creates Employee scoped to session.user.id (accountId); throws if not authenticated',
  },
  {
    export: 'renameEmployee',
    file: 'app/account/staff/actions.ts',
    reason: 'Session-gated: employee.updateMany where { id, accountId: session.user.id }; throws if not authenticated; cannot rename another account\'s employee',
  },
  {
    export: 'setEmployeeActive',
    file: 'app/account/staff/actions.ts',
    reason: 'Session-gated: employee.updateMany where { id, accountId: session.user.id }; throws if not authenticated',
  },
  {
    export: 'deleteEmployee',
    file: 'app/account/staff/actions.ts',
    reason: 'Session-gated: employee.deleteMany where { id, accountId: session.user.id }; throws if not authenticated; cannot delete another account\'s employee',
  },

  // ── Server actions excluded from gated-actions by design ──────────────────
  {
    export: 'createSite',
    file: 'app/sites/create/actions.ts',
    reason: 'Session-auth-only by design: user IS creating their site, so non-owner is correct. Covered by create/actions.test.ts',
  },
  {
    export: 'getBrand',
    file: 'app/sites/[id]/site-actions.ts',
    reason: 'SAFE — ownership enforced via query filter: site.findFirst where { id: siteId, userId: session.user.id } (site-actions.ts:336-339); returns null for non-owners. Auth-only (non-standard return: returns data|null not { status })',
  },
  {
    export: 'getSite',
    file: 'app/sites/[id]/queries.ts',
    reason: 'SAFE — ownership enforced via query filter: site.findFirst where { id: siteId, userId: session.user.id } (queries.ts:12-13); returns null for unauthenticated or non-owners. Bug #1 fixed. Auth-only (non-standard return: returns full site|null not { status }). Regression guard: queries.test.ts (3 tests).',
  },
  {
    export: 'getInventoryItems',
    file: 'app/sites/[id]/queries.ts',
    reason: 'SAFE — same gate as getSite: auth() then site.findFirst where { id: siteId, userId: session.user.id }; returns null for unauthenticated or non-owners (callers fall back to full refresh). Scoped read of items already visible via getSite. Regression guard: queries.test.ts.',
  },
  {
    export: 'getItemsByGroups',
    file: 'app/sites/[id]/queries.ts',
    reason: 'SAFE — same gate as getSite/getInventoryItems: auth() then site.findFirst where { id: siteId, userId: session.user.id }; returns null for unauthenticated or non-owners. Streams a parcel\'s seats for the track-020 C2 parcel tier (data already visible to the owner via getSite). Regression guard: queries.test.ts.',
  },
  {
    export: 'checkSlug',
    file: 'app/sites/[id]/site-actions.ts',
    reason: 'Auth-only (non-standard return: { available: boolean }); reads only existence of slug string, not any site data; returns false for unauthenticated',
  },
  {
    export: 'generateSlug',
    file: 'app/sites/[id]/site-actions.ts',
    reason: 'Auth-only (non-standard return: string); generates a slug from a site name string; no site data access',
  },
  {
    export: 'getProducts',
    file: 'app/sites/[id]/products/actions.ts',
    reason: 'SAFE — ownership enforced via requireSiteOwner(siteId) at products/actions.ts:271; returns [] for non-owners. Auth-only (non-standard return: Product[] not { status })',
  },
]

// ─── Build allowlist set ──────────────────────────────────────────────────────

function buildAllowlistSet(): Set<string> {
  const set = new Set<string>()
  for (const entry of UNGATED_ALLOWLIST) {
    const absFile = path.resolve(PARTNER_ROOT, entry.file)
    set.add(`${absFile}::${entry.export}`)
  }
  return set
}

// ─── Enumeration ─────────────────────────────────────────────────────────────

/** Enumerate all (file, export) pairs for 'use server' action files */
function enumerateServerActions(): Array<{ file: string; export: string }> {
  const pairs: Array<{ file: string; export: string }> = []

  // Glob all *actions*.ts files under app/ (excluding test files and mocks)
  const files = globSync('app/**/*actions*.ts', {
    cwd: PARTNER_ROOT,
    absolute: true,
  }).filter(
    (f) =>
      !f.endsWith('.test.ts') &&
      !f.endsWith('.integration.test.ts') &&
      !f.includes('__mocks__') &&
      !f.includes('/test/'),
  )

  for (const file of files) {
    if (!hasUseServerDirective(file)) continue
    const exports = parseServerActionExports(file)
    for (const name of exports) {
      pairs.push({ file, export: name })
    }
  }

  return pairs
}

/** Enumerate all (file, export) pairs for route handlers */
function enumerateRouteHandlers(): Array<{ file: string; export: string }> {
  const pairs: Array<{ file: string; export: string }> = []

  const files = globSync('app/**/route.ts', {
    cwd: PARTNER_ROOT,
    absolute: true,
  })

  for (const file of files) {
    const exports = parseRouteHandlerExports(file)
    for (const name of exports) {
      pairs.push({ file, export: name })
    }
  }

  return pairs
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('Coverage contract', () => {
  const coveredSet = buildCoveredSet()
  const allowlistSet = buildAllowlistSet()

  it('every "use server" action export is registered or allowlisted', () => {
    const actions = enumerateServerActions()
    const ungoverned: Array<{ file: string; export: string }> = []

    for (const pair of actions) {
      const key = `${pair.file}::${pair.export}`
      if (!coveredSet.has(key) && !allowlistSet.has(key)) {
        ungoverned.push(pair)
      }
    }

    if (ungoverned.length > 0) {
      const report = ungoverned
        .map(
          (p) =>
            `  UNGOVERNED server action: ${path.relative(PARTNER_ROOT, p.file)} :: ${p.export}`,
        )
        .join('\n')
      expect.fail(
        `\n${ungoverned.length} server action export(s) are neither registered in GATED_ACTIONS ` +
          `nor on the UNGATED_ALLOWLIST:\n${report}\n\n` +
          `Fix: add to GATED_ACTIONS in app/test/gated-actions.ts, ` +
          `or add a justified entry to UNGATED_ALLOWLIST in coverage-contract.test.ts`,
      )
    }

    expect(ungoverned).toHaveLength(0)
  })

  it('every route handler export is registered or allowlisted', () => {
    const routes = enumerateRouteHandlers()
    const ungoverned: Array<{ file: string; export: string }> = []

    for (const pair of routes) {
      const key = `${pair.file}::${pair.export}`
      if (!coveredSet.has(key) && !allowlistSet.has(key)) {
        ungoverned.push(pair)
      }
    }

    if (ungoverned.length > 0) {
      const report = ungoverned
        .map(
          (p) =>
            `  UNGOVERNED route handler: ${path.relative(PARTNER_ROOT, p.file)} :: ${p.export}`,
        )
        .join('\n')
      expect.fail(
        `\n${ungoverned.length} route handler export(s) are neither registered in GATED_ACTIONS ` +
          `nor on the UNGATED_ALLOWLIST:\n${report}\n\n` +
          `Fix: add to GATED_ACTIONS in app/test/gated-actions.ts, ` +
          `or add a justified entry to UNGATED_ALLOWLIST in coverage-contract.test.ts`,
      )
    }

    expect(ungoverned).toHaveLength(0)
  })

  it('UNGATED_ALLOWLIST has no stale entries (all files exist)', () => {
    const stale: string[] = []
    for (const entry of UNGATED_ALLOWLIST) {
      const absFile = path.resolve(PARTNER_ROOT, entry.file)
      if (!fs.existsSync(absFile)) {
        stale.push(entry.file)
      }
    }
    if (stale.length > 0) {
      expect.fail(
        `\nStale UNGATED_ALLOWLIST entries (files no longer exist):\n` +
          stale.map((f) => `  ${f}`).join('\n'),
      )
    }
    expect(stale).toHaveLength(0)
  })

  it('GATED_ACTIONS source files are resolvable (no broken import aliases)', () => {
    const symbolToFile = parseImportedSymbols(GATED_ACTIONS_FILE)
    const missing: string[] = []
    for (const [symbol, file] of symbolToFile.entries()) {
      if (!fs.existsSync(file)) {
        missing.push(`${symbol} → ${path.relative(PARTNER_ROOT, file)}`)
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `\nBroken imports in gated-actions.ts (file not found):\n` +
          missing.map((m) => `  ${m}`).join('\n'),
      )
    }
    expect(missing).toHaveLength(0)
  })
})
