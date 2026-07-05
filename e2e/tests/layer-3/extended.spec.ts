import { test, expect } from '../../fixtures'

/**
 * LAYER 3 — the rest. Peripheral but real flows: account/auth maintenance, i18n, branded
 * pages, and other long-tail surfaces. SCAFFOLD ONLY (`test.fixme`). See LAYERS.md.
 */

test.fixme('password reset works end-to-end', async ({ page }) => {
  // TODO: request reset → consume token → set new password → sign in with it.
  expect(true).toBe(true)
})

test.fixme('account settings update persists', async ({ page }) => {
  // TODO: /account → change a field → reload → value persisted.
  expect(true).toBe(true)
})

test.fixme('locale switch renders translated copy (EN/ES/FI)', async ({ page }) => {
  // TODO: switch locale → assert a known string changes across en/es/fi message files.
  expect(true).toBe(true)
})

test.fixme('branded site page loads via slug', async ({ page }) => {
  // TODO: /s/[slug] → branded site renders with the partner's brand name/colors.
  expect(true).toBe(true)
})
