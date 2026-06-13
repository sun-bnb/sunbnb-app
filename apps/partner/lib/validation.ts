/**
 * Shared server-side validation helpers for the partner app.
 */

import {
  ORDER_PENDING,
  ORDER_PROCESSING,
  ORDER_COMPLETE,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_DELIVERED,
  ORDER_COMPLETED,
  ORDER_REJECTED,
  ORDER_CANCELED,
  ORDER_REFUNDED,
  ORDER_PAYMENT_FAILED,
  ORDER_DISCARDED,
} from '@repo/data/reservation-status'

// ─── File Upload Validation ─────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB

export function validateImageFile(
  file: File
): { ok: true } | { ok: false; error: string } {
  if (!file || file.size === 0) {
    return { ok: false, error: 'No image provided' }
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { ok: false, error: `Invalid image type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF, SVG.` }
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum: 10 MB.` }
  }
  return { ok: true }
}

/**
 * Generate a safe blob storage key from a file.
 * Uses a UUID to avoid user-controlled path traversal or naming collisions.
 */
export function safeBlobKey(prefix: string, file: File): string {
  const ext = extensionFromMime(file.type)
  return `${prefix}/${crypto.randomUUID()}.${ext}`
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  }
  return map[mime] || 'bin'
}

// ─── Password Validation ────────────────────────────────────────────────────

const MIN_PASSWORD_LENGTH = 8

export function validatePassword(
  password: string
): { ok: true } | { ok: false; error: string } {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one lowercase letter' }
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one uppercase letter' }
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one number' }
  }
  return { ok: true }
}

// ─── Enum Validation ────────────────────────────────────────────────────────

const VALID_SITE_STATUSES = new Set(['active', 'hidden'])
// Consumer payments are Mollie-only (Stripe consumer payments removed; Stripe
// Connect is future work — see .claude/tracks/003-stripe-connect-compliance.md).
const VALID_PAYMENT_PROVIDERS = new Set(['mollie'])
const VALID_ORDER_STATUSES: Set<string> = new Set([
  ORDER_PENDING, ORDER_PROCESSING, ORDER_COMPLETE, ORDER_COMPLETED,
  ORDER_ACCEPTED, ORDER_PREPARING, ORDER_READY, ORDER_DELIVERED,
  ORDER_REJECTED, ORDER_CANCELED, ORDER_REFUNDED, ORDER_PAYMENT_FAILED,
  ORDER_DISCARDED,
])
const VALID_PRODUCT_CATEGORIES = new Set(['food', 'drink', 'snack', 'accessory'])
const VALID_ORDER_PAYMENT_TYPES = new Set(['paid', 'unpaid'])
const VALID_RENTAL_PAYMENT_TYPES = new Set(['paid', 'unpaid'])
const VALID_ITEM_STATUSES = new Set(['active', 'disabled', 'pool'])

export function isValidSiteStatus(s: string): boolean {
  return VALID_SITE_STATUSES.has(s)
}

export function isValidPaymentProvider(s: string): boolean {
  return VALID_PAYMENT_PROVIDERS.has(s)
}

export function isValidOrderStatus(s: string): boolean {
  return VALID_ORDER_STATUSES.has(s)
}

export function isValidOrderPaymentType(s: string): boolean {
  return VALID_ORDER_PAYMENT_TYPES.has(s)
}

export function isValidRentalPaymentType(s: string): boolean {
  return VALID_RENTAL_PAYMENT_TYPES.has(s)
}

export function isValidItemStatus(s: string): boolean {
  return VALID_ITEM_STATUSES.has(s)
}

export function isValidProductCategory(s: string): boolean {
  return VALID_PRODUCT_CATEGORIES.has(s)
}
