import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Match Next's automatic JSX runtime so transformed .tsx (e.g. server
  // components returning JSX) don't need an explicit `import React`.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['app/**/*.test.ts'],
    exclude: ['app/**/*.integration.test.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['app/**/*.ts'],
      exclude: [
        'app/**/*.test.ts',
        'app/**/*.integration.test.ts',
        'app/test/**',
        '**/__mocks__/**',
      ],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      '@repo/data/PrismaCient': path.resolve(__dirname, '__mocks__/@repo/data/PrismaCient'),
      '@repo/data/payment': path.resolve(__dirname, '__mocks__/@repo/data/payment'),
      '@repo/data/reservation-status': path.resolve(__dirname, '../../packages/data/src/reservation-status'),
      '@repo/data/reservation-emails': path.resolve(__dirname, '__mocks__/@repo/data/reservation-emails'),
      '@repo/data/rental-emails': path.resolve(__dirname, '__mocks__/@repo/data/rental-emails'),
      '@repo/data/env': path.resolve(__dirname, '__mocks__/@repo/data/env'),
      '@repo/data/password-reset': path.resolve(__dirname, '__mocks__/@repo/data/password-reset'),
      '@repo/data/rate-limit': path.resolve(__dirname, '__mocks__/@repo/data/rate-limit'),
      '@repo/data/reservations': path.resolve(__dirname, '__mocks__/@repo/data/reservations'),
      '@repo/data/reservation-payment': path.resolve(__dirname, '__mocks__/@repo/data/reservation-payment'),
    },
  },
})
