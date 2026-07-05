import { test, expect } from '../../fixtures'

/**
 * LAYER 1 — rest of core. Critical paths beyond the headline loop: cancellation/refund,
 * the anonymous POS/QR flow, and inventory→availability propagation. SCAFFOLD ONLY (`test.fixme`).
 * See LAYERS.md for the taxonomy and the shared open questions (auth, seed/cleanup, payment).
 */

test.fixme('consumer cancels a paid reservation and is refunded', async ({ page }) => {
  // TODO: book + pay (demo) → cancel from /reservations/[id] → status CANCELED/REFUNDED;
  // /db confirms refund path (issueRefund) ran.
  expect(true).toBe(true)
})

test.fixme('anonymous POS/QR booking creates a reservation without login', async ({ page }) => {
  // TODO: /sites/[id]/pos with an anonId in localStorage → reserve → reservation owned by anonId.
  expect(true).toBe(true)
})

test.fixme('partner inventory edits propagate to consumer availability', async ({ page }) => {
  // TODO: toggle/add a seat in the partner inventory editor → /api/sites/[id]/availability reflects it.
  expect(true).toBe(true)
})
