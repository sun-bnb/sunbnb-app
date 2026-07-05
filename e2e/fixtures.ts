import { test as base, expect } from '@playwright/test'

// Shared fixtures for the e2e layer. Specs import `test` / `expect` from HERE, not from
// `@playwright/test` directly, so every test gets the cookie-banner dismiss and the
// uncaught-error collector for free.

type Fixtures = {
  // Uncaught exceptions thrown by the page during the test. Assert this stays empty for a
  // clean boot. Preferred over asserting zero console.error, which is noisy on Next dev.
  pageErrors: string[]
}

export const test = base.extend<Fixtures>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await use(errors)
  },

  // Auto-dismiss the cookie banner once the first navigation has happened — mirrors
  // handle.mjs openApp(): best-effort click on the "OK" button, swallow if it's not there.
  page: async ({ page }, use) => {
    const dismissCookie = async () => {
      try {
        await page.getByRole('button', { name: 'OK' }).click({ timeout: 2500 })
      } catch {
        /* banner absent / already dismissed */
      }
    }
    page.on('load', () => void dismissCookie())
    await use(page)
  },
})

export { expect }
